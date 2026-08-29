use std::{env, fs, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=src/pdf_redactor.swift");
    let target = env::var("TARGET").expect("Cargo did not provide TARGET");
    let output_directory =
        PathBuf::from(env::var_os("OUT_DIR").expect("Cargo did not provide OUT_DIR"));
    let helper_path = output_directory.join("pdf-redactor-helper");

    if target.ends_with("apple-darwin") {
        let swift_target = if target.starts_with("aarch64") {
            "arm64-apple-macosx13.0"
        } else {
            "x86_64-apple-macosx13.0"
        };
        let module_cache = output_directory.join("swift-module-cache");
        fs::create_dir_all(&module_cache).expect("Could not create the Swift module cache");

        let result = Command::new("xcrun")
            .args([
                "swiftc",
                "src/pdf_redactor.swift",
                "-O",
                "-target",
                swift_target,
                "-module-cache-path",
            ])
            .arg(&module_cache)
            .args([
                "-framework",
                "AppKit",
                "-framework",
                "PDFKit",
                "-framework",
                "Vision",
                "-o",
            ])
            .arg(&helper_path)
            .status()
            .expect("Could not start Swift to build the local PDF redactor");

        if !result.success() {
            panic!("Could not build the local PDF redactor");
        }
    } else {
        // Keep include_bytes! valid on unsupported targets. The Rust adapter
        // returns a clear platform error before trying to execute this file.
        fs::write(&helper_path, []).expect("Could not create the PDF redactor placeholder");
    }

    tauri_build::build()
}
