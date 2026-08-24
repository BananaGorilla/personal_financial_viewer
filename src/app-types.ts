export type TabName = "statements" | "assets" | "insurance" | "dashboard" | "settings";

export type AppContext = {
  events: EventTarget;
  selectTab: (tabName: TabName, focus?: boolean) => void;
};

export type TabController = {
  onActivate?: () => void;
  destroy?: () => void;
};

export type TabDefinition = {
  id: TabName;
  label: string;
  icon: string;
  panelClassName?: string;
  render: () => string;
  mount: (panel: HTMLElement, context: AppContext) => TabController | void;
};
