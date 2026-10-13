# Damon's Tools

A Claude Code mod: a dashboard pane that shows

- **Model** – the models you can use, with the one in use highlighted. Click another to switch.
- **Effort** – the effort levels, with the current one highlighted. Click another to change it.
- **Settings** – every plugin you have installed, read from Claude Code's own plugin list. Plugins you install later appear on their own. Each row has:
  - a dot on the left: **green** when the plugin is loaded in Claude Code, **red** when it is installed but disabled;
  - a toggle on the right: **green** when on, **grey** when off. It turns the plugin on or off and leaves it installed.

It also turns the bar under the prompt into a status bar: plan, model and context size,
effort, a context meter, 5-hour usage, running agents, and a **◆ Damon's Tools** button
on the right that hides and shows the dashboard.
Plugins that know about it (Clean View, Prompt Upgrade, Auto Model) leave their own
buttons out of that bar while Damon's Tools is installed: they look for its
`/damons-tools` command.

A plugin with a switch of its own (Auto Model, Clean View, Prompt Upgrade) stays loaded
when its toggle is off: the dashboard runs its command, such as `/automodel off`. A
plugin offers that switch by answering `/<plugin name> on` and `off` and keeping `isOn`
in its store. Any other plugin is enabled or disabled instead, which is saved at once;
where plugins cannot be reloaded in the running session, the dashboard marks it
"pending · next session".

## Install

```
claude plugin marketplace add mugenracerman/damons-tools
claude plugin install damons-tools@damons-tools
```

`/damons-tools` reopens the dashboard.
