# Damon's Tools

A Claude Code mod: a dashboard pane that shows

- **Model** – the models you can use, with the one in use highlighted. Click another to switch.
- **Effort** – the effort levels, with the current one highlighted. Click another to change it.
- **Settings** – every plugin you have installed, read from Claude Code's own plugin list, each with an On/Off switch. Plugins you install later appear on their own.

It also puts a single **Dashboard: Shown / Hidden** button in the bar under the prompt.
Plugins that know about it (Clean View, Prompt Upgrade, Auto Model) leave their own
buttons out of that bar while Damon's Tools is installed: they look for its
`/damons-tools` command.

A plugin switched on or off is saved at once. Where plugins cannot be reloaded in the
running session, the dashboard marks it "pending · next session".

## Install

```
claude plugin marketplace add mugenracerman/damons-tools
claude plugin install damons-tools@damons-tools
```

`/damons-tools` reopens the dashboard.
