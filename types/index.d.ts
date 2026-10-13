export type PluginRow = {
  id: string
  name: string
  description: string
  // Enabled in Claude Code, so its code loads: the dot on the left.
  isEnabled: boolean
  // Saved one way, but this session still runs it the other way.
  isPending: boolean
  // The plugin keeps a switch of its own: a command under its name taking
  // `on` and `off`, and `isOn` in its store.
  hasSwitch: boolean
  // What the toggle on the right shows: its own switch when it has one, else
  // whether it is enabled.
  isOn: boolean
}

export type ModelChoice = { alias: string; label: string }

// Which plugins this session is running: the saved settings when it started,
// updated only by a plugin reload that went through.
export type Running = { sessionId: string; enabled: Record<string, boolean> }

// The status bar's figures: the context window and its fill, and the 5-hour
// rate-limit window (null off a subscription or before the first reading).
export type Usage = {
  window: number
  contextPercent: number | null
  fiveHourPercent: number | null
  isSubscription: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'damons-tools': {
      model: string
      effort: string | null
      models: ModelChoice[]
      plugins: PluginRow[]
      notice: string | null
      running: Running | null
      isShown: boolean
      usage: Usage
      agents: number
    }
  }
}
