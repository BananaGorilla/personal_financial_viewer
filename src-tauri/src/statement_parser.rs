use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionKind {
    Purchase,
    Fee,
    Payment,
    Credit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CardTransaction {
    /// ISO-8601 transaction date inferred from the statement date.
    pub date: String,
    pub description: String,
    /// Positive values increase the card balance; credits/payments are negative.
    pub amount_cents: i64,
    pub currency: String,
    pub kind: TransactionKind,
    pub card_last_four: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StatementSummary {
    pub previous_balance_cents: i64,
    pub payments_and_credits_cents: i64,
    pub purchases_and_advances_cents: i64,
    pub interest_cents: i64,
    pub fees_cents: i64,
    pub current_balance_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Reconciliation {
    pub transaction_net_cents: i64,
    pub expected_current_balance_cents: Option<i64>,
    pub difference_cents: Option<i64>,
    pub is_balanced: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ParsedCardStatement {
    pub parser: &'static str,
    pub statement_date: String,
    pub currency: String,
    pub account_last_four: Option<String>,
    pub summary: Option<StatementSummary>,
    pub transactions: Vec<CardTransaction>,
    pub reconciliation: Reconciliation,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
struct PendingTransaction {
    day: u32,
    month: u32,
    description_parts: Vec<String>,
    amount_cents: Option<i64>,
    card_last_four: Option<String>,
    source_order: usize,
}

/// Parser for the embedded text layer used by Citi Singapore card statements.
///
/// The parser deliberately works from transaction boundaries instead of PDF
/// coordinates. Citi's text layer may place the amount on the next line and may
/// put a foreign-currency reference amount before the billed SGD amount.
pub struct CitiCreditCardParser;

impl CitiCreditCardParser {
    pub fn can_parse(text: &str) -> bool {
        let upper = text.to_ascii_uppercase();
        upper.contains("CITIBANK SINGAPORE")
            && upper.contains("AMOUNT (SGD)")
            && upper.contains("TRANSACTIONS FOR CITI")
    }

    pub fn parse(text: &str) -> Result<ParsedCardStatement, String> {
        if !Self::can_parse(text) {
            return Err("This is not a supported Citi Singapore credit-card statement".into());
        }

        let (statement_year, statement_month, statement_day) = parse_statement_date(text)?;
        let statement_date = format!("{statement_year:04}-{statement_month:02}-{statement_day:02}");
        let account_last_four = parse_account_last_four(text);
        let summary = parse_summary(text);
        let masked_card = Regex::new(r"XXXX-XXXX-XXXX-(\d{4})").expect("valid regex");

        let mut transactions_with_order = Vec::new();
        let mut pending: Option<PendingTransaction> = None;
        let mut source_order = 0;

        for raw_line in text.lines() {
            let line = normalize_whitespace(raw_line);
            if line.is_empty() {
                continue;
            }

            if let Some((day, month, remainder)) = split_transaction_start(&line) {
                finish_pending(
                    pending.take(),
                    statement_year,
                    statement_month,
                    &mut transactions_with_order,
                );

                let card_last_four = masked_card
                    .captures(&remainder)
                    .and_then(|captures| captures.get(1))
                    .map(|value| value.as_str().to_owned());
                let remainder =
                    normalize_whitespace(masked_card.replace_all(&remainder, "").as_ref());
                let (description, amount_cents) = split_billed_amount(&remainder);
                pending = Some(PendingTransaction {
                    day,
                    month,
                    description_parts: vec![description],
                    amount_cents,
                    card_last_four,
                    source_order,
                });
                source_order += 1;
                continue;
            }

            let Some(current) = pending.as_mut() else {
                continue;
            };

            if let Some(captures) = masked_card.captures(&line) {
                current.card_last_four = captures.get(1).map(|value| value.as_str().to_owned());
                continue;
            }

            if line.to_ascii_uppercase().contains("FOREIGN AMOUNT") {
                current.description_parts.push(line);
                continue;
            }

            if current.amount_cents.is_none() {
                if let Some(amount) = parse_amount(&line) {
                    current.amount_cents = Some(amount);
                    continue;
                }

                if is_description_continuation(&line) {
                    current.description_parts.push(line);
                    continue;
                }
            }

            // Once an amount is complete, any non-card line belongs to a header,
            // total, or the next page rather than to the transaction description.
            finish_pending(
                pending.take(),
                statement_year,
                statement_month,
                &mut transactions_with_order,
            );
        }

        finish_pending(
            pending,
            statement_year,
            statement_month,
            &mut transactions_with_order,
        );

        transactions_with_order.sort_by(|(left, left_order), (right, right_order)| {
            left.date
                .cmp(&right.date)
                .then_with(|| left_order.cmp(right_order))
        });
        let transactions: Vec<_> = transactions_with_order
            .into_iter()
            .map(|(transaction, _)| transaction)
            .collect();

        let transaction_net_cents = transactions.iter().map(|item| item.amount_cents).sum();
        let (expected_current_balance_cents, difference_cents, is_balanced) = match &summary {
            Some(summary) => {
                let expected = summary.previous_balance_cents + transaction_net_cents;
                let difference = expected - summary.current_balance_cents;
                (Some(expected), Some(difference), difference == 0)
            }
            None => (None, None, false),
        };

        let mut warnings = Vec::new();
        if transactions.is_empty() {
            warnings.push("No transactions were found".into());
        }
        if summary.is_none() {
            warnings.push("The balance summary could not be read".into());
        } else if !is_balanced {
            warnings.push(format!(
                "Transactions do not reconcile to the current balance (difference: {} cents)",
                difference_cents.unwrap_or_default()
            ));
        }

        Ok(ParsedCardStatement {
            parser: "citi_sg_credit_card_v1",
            statement_date,
            currency: "SGD".into(),
            account_last_four,
            summary,
            transactions,
            reconciliation: Reconciliation {
                transaction_net_cents,
                expected_current_balance_cents,
                difference_cents,
                is_balanced,
            },
            warnings,
        })
    }
}

fn parse_statement_date(text: &str) -> Result<(i32, u32, u32), String> {
    let regex = Regex::new(
        r"(?i)Statement Date:?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})",
    )
    .expect("valid regex");
    let captures = regex
        .captures(text)
        .ok_or_else(|| "Statement date was not found".to_string())?;
    let month = month_number(captures.get(1).unwrap().as_str())
        .ok_or_else(|| "Statement month is invalid".to_string())?;
    let day = captures
        .get(2)
        .unwrap()
        .as_str()
        .parse::<u32>()
        .map_err(|_| "Statement day is invalid")?;
    let year = captures
        .get(3)
        .unwrap()
        .as_str()
        .parse::<i32>()
        .map_err(|_| "Statement year is invalid")?;
    Ok((year, month, day))
}

fn parse_account_last_four(text: &str) -> Option<String> {
    let regex = Regex::new(r"(?i)MASTERCARD\s+(?:\d{4}\s+){3}(\d{4})").expect("valid regex");
    regex
        .captures(text)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_owned())
}

fn parse_summary(text: &str) -> Option<StatementSummary> {
    for line in text.lines() {
        let values: Vec<i64> = line
            .split_whitespace()
            .filter_map(parse_unsigned_amount)
            .collect();
        if values.len() != 6 {
            continue;
        }

        let calculated = values[0] - values[1] + values[2] + values[3] + values[4];
        if calculated == values[5] {
            return Some(StatementSummary {
                previous_balance_cents: values[0],
                payments_and_credits_cents: values[1],
                purchases_and_advances_cents: values[2],
                interest_cents: values[3],
                fees_cents: values[4],
                current_balance_cents: values[5],
            });
        }
    }
    None
}

fn split_transaction_start(line: &str) -> Option<(u32, u32, String)> {
    let mut parts = line.splitn(3, ' ');
    let day_text = parts.next()?;
    let month_text = parts.next()?;
    let remainder = parts.next()?.trim();
    if day_text.len() != 2 || !day_text.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    let day = day_text.parse::<u32>().ok()?;
    if !(1..=31).contains(&day) {
        return None;
    }
    let month = short_month_number(month_text)?;
    if remainder.is_empty() {
        return None;
    }
    Some((day, month, remainder.to_owned()))
}

fn split_billed_amount(remainder: &str) -> (String, Option<i64>) {
    let tokens: Vec<&str> = remainder.split_whitespace().collect();
    let amount_tokens = tokens
        .iter()
        .filter(|token| parse_amount(token).is_some())
        .count();
    let last_amount = tokens.last().and_then(|token| parse_amount(token));
    let is_foreign_reference = remainder.to_ascii_uppercase().contains("FOREIGN AMOUNT");

    if let Some(amount) = last_amount {
        // A foreign transaction with only one decimal amount is showing the
        // original currency amount. Its billed SGD amount arrives on a later line.
        if !(is_foreign_reference && amount_tokens == 1) {
            let description = tokens[..tokens.len() - 1].join(" ");
            return (description, Some(amount));
        }
    }
    (remainder.to_owned(), None)
}

fn finish_pending(
    pending: Option<PendingTransaction>,
    statement_year: i32,
    statement_month: u32,
    output: &mut Vec<(CardTransaction, usize)>,
) {
    let Some(pending) = pending else {
        return;
    };
    let Some(amount_cents) = pending.amount_cents else {
        return;
    };

    let year = if pending.month > statement_month {
        statement_year - 1
    } else {
        statement_year
    };
    let description = pending.description_parts.join(" ").trim().to_owned();
    let upper = description.to_ascii_uppercase();
    let kind = if amount_cents < 0 {
        if upper.contains("PAYMENT") || upper.contains("MONEYSEND") {
            TransactionKind::Payment
        } else {
            TransactionKind::Credit
        }
    } else if has_word(&upper, "FEE") {
        TransactionKind::Fee
    } else {
        TransactionKind::Purchase
    };

    output.push((
        CardTransaction {
            date: format!("{year:04}-{:02}-{:02}", pending.month, pending.day),
            description,
            amount_cents,
            currency: "SGD".into(),
            kind,
            card_last_four: pending.card_last_four,
        },
        pending.source_order,
    ));
}

fn is_description_continuation(line: &str) -> bool {
    let upper = line.to_ascii_uppercase();
    upper.contains("FOREIGN AMOUNT")
        || (!upper.starts_with("PAGE ")
            && !upper.starts_with("SUB-TOTAL")
            && !upper.starts_with("GRAND TOTAL")
            && !upper.starts_with("DATE DESCRIPTION")
            && !upper.starts_with("EPSTCSX"))
}

fn parse_unsigned_amount(token: &str) -> Option<i64> {
    let value = parse_amount(token)?;
    (value >= 0).then_some(value)
}

fn parse_amount(value: &str) -> Option<i64> {
    let trimmed = value.trim();
    let negative = trimmed.starts_with('(') && trimmed.ends_with(')');
    let numeric = if negative {
        &trimmed[1..trimmed.len().checked_sub(1)?]
    } else {
        trimmed
    };
    let numeric = numeric.replace(',', "");
    let (whole, fraction) = numeric.split_once('.')?;
    if whole.is_empty()
        || fraction.len() != 2
        || !whole.chars().all(|ch| ch.is_ascii_digit())
        || !fraction.chars().all(|ch| ch.is_ascii_digit())
    {
        return None;
    }
    let cents = whole.parse::<i64>().ok()?.checked_mul(100)? + fraction.parse::<i64>().ok()?;
    Some(if negative { -cents } else { cents })
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn has_word(value: &str, expected: &str) -> bool {
    value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|word| word == expected)
}

fn short_month_number(value: &str) -> Option<u32> {
    match value.to_ascii_uppercase().as_str() {
        "JAN" => Some(1),
        "FEB" => Some(2),
        "MAR" => Some(3),
        "APR" => Some(4),
        "MAY" => Some(5),
        "JUN" => Some(6),
        "JUL" => Some(7),
        "AUG" => Some(8),
        "SEP" => Some(9),
        "OCT" => Some(10),
        "NOV" => Some(11),
        "DEC" => Some(12),
        _ => None,
    }
}

fn month_number(value: &str) -> Option<u32> {
    match value.to_ascii_lowercase().as_str() {
        "january" => Some(1),
        "february" => Some(2),
        "march" => Some(3),
        "april" => Some(4),
        "may" => Some(5),
        "june" => Some(6),
        "july" => Some(7),
        "august" => Some(8),
        "september" => Some(9),
        "october" => Some(10),
        "november" => Some(11),
        "december" => Some(12),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{CitiCreditCardParser, TransactionKind};

    const SAMPLE: &str = r#"
Citibank Singapore Ltd
Statement Date June 19, 2026
CITI CASH BACK PLUS MASTERCARD 5425 5045 0380 0127
TRANSACTIONS FOR CITI CASH BACK PLUS MASTERCARD
DATE DESCRIPTION AMOUNT (SGD)
100.00 50.00 17.64 0.00 0.05 67.69
30 MAY MONEYSEND CARD PAYMENT SINGAPORE SG (50.00)
11 MAY NTUC FairPrice App Pay SINGAPORE SG XXXX-XXXX-XXXX-5338
10.90
26 MAY YANG CHIN TAIPEI CITY TW FOREIGN AMOUNT NEW TAIWAN DOLLAR 160.00
XXXX-XXXX-XXXX-5338
6.74
11 JUN CCY CONVERSION FEE SGD 5.98 0.05
"#;

    #[test]
    fn parses_multiline_foreign_amounts_and_credits() {
        let parsed = CitiCreditCardParser::parse(SAMPLE).expect("statement should parse");

        assert_eq!(parsed.statement_date, "2026-06-19");
        assert_eq!(parsed.account_last_four.as_deref(), Some("0127"));
        assert_eq!(parsed.transactions.len(), 4);
        assert_eq!(parsed.transactions[0].date, "2026-05-11");
        assert_eq!(parsed.transactions[0].amount_cents, 1090);
        assert_eq!(
            parsed.transactions[0].card_last_four.as_deref(),
            Some("5338")
        );
        assert_eq!(parsed.transactions[1].amount_cents, 674);
        assert!(parsed.transactions[1].description.contains("160.00"));
        assert_eq!(parsed.transactions[2].kind, TransactionKind::Payment);
        assert_eq!(parsed.transactions[2].amount_cents, -5000);
        assert_eq!(parsed.transactions[3].kind, TransactionKind::Fee);
        assert_eq!(parsed.transactions[3].amount_cents, 5);
    }

    #[test]
    fn reconciles_transactions_to_the_statement_balance() {
        let parsed = CitiCreditCardParser::parse(SAMPLE).expect("statement should parse");
        assert!(parsed.reconciliation.is_balanced);
        assert_eq!(parsed.reconciliation.transaction_net_cents, -3231);
        assert_eq!(
            parsed.reconciliation.expected_current_balance_cents,
            Some(6769)
        );
        assert!(parsed.warnings.is_empty());
    }

    #[test]
    fn rejects_other_statement_formats() {
        let error = CitiCreditCardParser::parse("another bank").unwrap_err();
        assert!(error.contains("not a supported"));
    }

    #[test]
    fn does_not_treat_coffee_as_a_fee() {
        let sample = SAMPLE.replace(
            "11 JUN CCY CONVERSION FEE SGD 5.98 0.05",
            "11 JUN STARBUCKS COFFEE SINGAPORE SG 0.05",
        );
        let parsed = CitiCreditCardParser::parse(&sample).expect("statement should parse");
        assert_eq!(parsed.transactions[3].kind, TransactionKind::Purchase);
    }
}
