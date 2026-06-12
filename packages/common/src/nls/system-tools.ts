export enum NlsSystemTool {
  AskUser = "ask_user",
  Bash = "bash",
  Create = "create",
  Edit = "edit",
  FetchCopilotCliDocumentation = "fetch_copilot_cli_documentation",
  Glob = "glob",
  Grep = "grep",
  ListBash = "list_bash",
  ReadBash = "read_bash",
  ReportIntent = "report_intent",
  StopBash = "stop_bash",
  StrReplaceEditor = "str_replace_editor",
  Task = "task",
  View = "view",
  WebFetch = "web_fetch",
  WriteBash = "write_bash",
}

export const ALL_NLS_SYSTEM_TOOLS = Object.values(NlsSystemTool)

export const DEFAULT_NLS_SYSTEM_TOOLS: NlsSystemTool[] = [
  NlsSystemTool.WebFetch,
  NlsSystemTool.Bash,
  NlsSystemTool.ReadBash,
  NlsSystemTool.WriteBash,
  NlsSystemTool.StopBash,
  NlsSystemTool.ListBash,
  NlsSystemTool.ReportIntent,
]
