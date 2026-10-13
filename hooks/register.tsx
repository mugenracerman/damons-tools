import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModelChoice, PluginRow, Running, Usage } from '../types'

const PANE = 'damons-tools'
const TITLE = "Damon's Tools"

const ACCENT = '#e8875b'
const EFFORT_BG = '#a06a9a'
const ON_BG = '#2bb673'
const OFF_BG = '#3a3a3a'
const TOGGLE_OFF = '#6e7681'
const PENDING = '#e0b341'

// Status bar colors.
const PLAN = '#9ccc8a'
const MODEL_MARK = '#4aa3ff'
const EFFORT_FG = '#e0b341'
const GOOD = '#2bb673'
const WARN = '#e0b341'
const BAD = '#e5534b'

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const FAMILIES: ModelChoice[] = [
  { alias: 'haiku', label: 'Haiku' },
  { alias: 'sonnet', label: 'Sonnet' },
  { alias: 'opus', label: 'Opus' },
  { alias: 'fable', label: 'Fable' },
]
// Latest version per family, used to label models not currently in use.
const LATEST: Record<string, string> = { haiku: '5.5', sonnet: '5.5', opus: '5.5', fable: '5.1' }

const model = atom({ plugin: 'damons-tools', key: 'model' } as const, '')
const effort = atom({ plugin: 'damons-tools', key: 'effort' } as const, null)
const models = atom({ plugin: 'damons-tools', key: 'models' } as const, FAMILIES)
const plugins = atom({ plugin: 'damons-tools', key: 'plugins' } as const, [])
const notice = atom({ plugin: 'damons-tools', key: 'notice' } as const, null)
const isShown = atom({ plugin: 'damons-tools', key: 'isShown' } as const, true)
const running = atom({ plugin: 'damons-tools', key: 'running' } as const, null as Running | null)
const usage = atom({ plugin: 'damons-tools', key: 'usage' } as const, {
  window: 0,
  contextPercent: null,
  fiveHourPercent: null,
  isSubscription: false,
} as Usage)
const agents = atom({ plugin: 'damons-tools', key: 'agents' } as const, 0)

type $ = EngineInterface

async function home($: $): Promise<string> {
  return ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
}

function titleCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function shorten(text: string, max = 42): string {
  const first = (text.split(/(?<=[.!?])\s/)[0] ?? '').trim()
  return first.length > max ? first.slice(0, max - 1).trimEnd() + '…' : first
}

function familyOf(id: string): string | undefined {
  const lower = id.toLowerCase()
  return FAMILIES.find(f => lower.includes(f.alias))?.alias
}

// "claude-opus-5-5[1m]" -> "Opus 5.5"
function modelLabel(id: string): string {
  const fam = familyOf(id)
  if (!fam) return id
  const version = id.toLowerCase().match(new RegExp(`${fam}-(\\d+)(?:-(\\d{1,2}))?(?!\\d)`))
  const v = version ? (version[2] ? `${version[1]}.${version[2]}` : version[1]) : LATEST[fam]
  return `${titleCase(fam)} ${v}`
}

function effortLabel(level: string): string {
  return level === 'xhigh' ? 'XHigh' : titleCase(level)
}

// 1000000 -> "1M", 200000 -> "200K"
function windowLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return tokens > 0 ? String(tokens) : ''
}

function levelColor(percent: number): string {
  return percent >= 80 ? BAD : percent >= 50 ? WARN : GOOD
}

// Ten cells, filled in proportion to the percentage.
function meter(percent: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)))
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled)
}

async function measure($: $) {
  try {
    const { context, rateLimits } = await $.session.usage()
    const fiveHour = rateLimits.find(r => r.kind === 'five_hour')
    const next: Usage = {
      window: context.window,
      contextPercent: context.percent ?? null,
      fiveHourPercent: fiveHour ? Math.round(fiveHour.percentUsed) : null,
      isSubscription: rateLimits.length > 0,
    }
    const prev = await read($, usage)
    if (JSON.stringify(prev) !== JSON.stringify(next)) await update($, usage, () => next)
  } catch {}
}

const ACTIVE = new Set(['pending', 'running', 'waiting'])

async function countAgents($: $) {
  try {
    const count = (await $.agent.list()).filter(a => ACTIVE.has(a.status)).length
    if (count !== (await read($, agents))) await update($, agents, () => count)
  } catch {}
}

// Every plugin in installed_plugins.json, whatever is installed now: nothing is hard-coded.
async function scanPlugins($: $): Promise<PluginRow[]> {
  const base = `${await home($)}/.claude`
  let installed: Record<string, { installPath?: string }[]> = {}
  try {
    installed = JSON.parse(await $.fs.read(`${base}/plugins/installed_plugins.json`)).plugins ?? {}
  } catch {
    return []
  }
  const settings = await $.settings.read()
  const enabled = (settings.enabledPlugins ?? {}) as Record<string, unknown>
  const live = (await read($, running))?.enabled ?? {}
  const [commands, stores] = await Promise.all([
    $.command
      .list()
      .then(list => new Set(list.map(c => c.name)))
      .catch(() => new Set<string>()),
    $.fs.list(`${base}/plugins/store`).catch(() => []),
  ])

  const rows = await Promise.all(
    Object.entries(installed).map(async ([id, installs]) => {
      const name = id.split('@')[0] ?? id
      const isEnabled = enabled[id] !== false
      const switchOn = await savedSwitch($, base, id, stores)
      const hasSwitch = isEnabled && commands.has(name) && switchOn !== undefined
      let description = ''
      const path = installs?.[0]?.installPath
      if (path) {
        try {
          const manifest = JSON.parse(await $.fs.read(`${path.replace(/\\/g, '/')}/.claude-plugin/plugin.json`))
          description = manifest.description ?? ''
        } catch {}
      }
      const isPending = id in live && live[id] !== isEnabled
      const isOn = hasSwitch ? switchOn === true : isEnabled
      return { id, name: titleCase(name), description: shorten(description), isEnabled, isPending, hasSwitch, isOn }
    }),
  )
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

// A plugin's own switch, `isOn` in its store (`<name>_<marketplace>-<hash>.json`);
// undefined when it keeps none.
async function savedSwitch(
  $: $,
  base: string,
  id: string,
  stores: readonly { name: string; kind: string }[],
): Promise<boolean | undefined> {
  const prefix = `${id.replace('@', '_')}-`
  const file = stores.find(f => f.kind === 'file' && f.name.startsWith(prefix) && f.name.endsWith('.json'))
  if (!file) return undefined
  try {
    const value = JSON.parse(await $.fs.read(`${base}/plugins/store/${file.name}`)).isOn
    return typeof value === 'boolean' ? value : undefined
  } catch {
    return undefined
  }
}

async function scanModels($: $): Promise<ModelChoice[]> {
  try {
    const row = (await $.config.list()).find(r => r.key === 'model')
    const options = row?.options?.map(o => o.toLowerCase()) ?? []
    const offered = FAMILIES.filter(f => options.some(o => o.includes(f.alias)))
    if (offered.length > 0) return offered
  } catch {}
  return FAMILIES
}

async function refresh($: $) {
  const [list, choices, current] = await Promise.all([scanPlugins($), scanModels($), $.session.model()])
  await update($, plugins, () => list)
  await update($, models, () => choices)
  await update($, model, () => current)
}

// Follows /model and /effort typed anywhere: the live values, written only when they changed.
async function sync($: $) {
  try {
    const current = await $.session.model()
    if (current !== (await read($, model))) {
      await update($, model, () => current)
      // A model with no effort setting shows none; the next request reports it exactly.
    }
    const row = (await $.config.list()).find(r => /effort/i.test(r.key))
    const level = typeof row?.value === 'string' ? row.value.toLowerCase() : undefined
    if (level && (EFFORTS as readonly string[]).includes(level) && level !== (await read($, effort))) {
      await update($, effort, () => level)
    }
  } catch {}
  await Promise.all([measure($), countAgents($)])
}

// True only when the reload ran: it throws, or answers with a refusal, where it
// cannot (over a remote connection, for one).
async function reloadPlugins($: $): Promise<boolean> {
  try {
    const { text } = await $.command.run({ command: 'reload-plugins', args: '' })
    $.ui.log(`reload-plugins answered: ${text ?? '(nothing)'}`, { to: 'debug' })
    return !/isn.t available|not available|unavailable|unknown|fail|error|cannot|can.t|unable|denied/i.test(text ?? '')
  } catch {
    return false
  }
}

// The first load in a session records what the session started with; a hot
// reload of this mod in the same session keeps the record it already has.
async function recordRunning($: $) {
  const sessionId = await $.session.id()
  if ((await read($, running))?.sessionId === sessionId) return
  const enabled = (((await $.settings.read()).enabledPlugins ?? {}) as Record<string, unknown>)
  const snapshot: Record<string, boolean> = {}
  for (const [id, on] of Object.entries(enabled)) snapshot[id] = on !== false
  await update($, running, () => ({ sessionId, enabled: snapshot }))
}

// Shows or hides the dashboard for this session; every new session opens it.
async function setShown($: $, shown: boolean) {
  await update($, isShown, () => shown)
  if (shown) await $.ui.open({ id: PANE, title: TITLE })
  else await $.ui.close({ id: PANE })
}

async function setPlugin($: $, row: PluginRow, isEnabled: boolean) {
  const file = `${await home($)}/.claude/settings.json`
  try {
    let settings: Record<string, any> = {}
    try {
      settings = JSON.parse(await $.fs.read(file))
    } catch {}
    settings.enabledPlugins = { ...(settings.enabledPlugins ?? {}), [row.id]: isEnabled }
    await $.fs.write(file, JSON.stringify(settings, null, 2) + '\n')
    if (await reloadPlugins($)) {
      await update($, running, r => (r ? { ...r, enabled: { ...r.enabled, [row.id]: isEnabled } } : r))
      await update($, notice, () => `${row.name} turned ${isEnabled ? 'on' : 'off'}`)
    } else {
      await update($, notice, () => `${row.name} ${isEnabled ? 'on' : 'off'}: saved – takes effect next session`)
    }
  } catch (err) {
    await update($, notice, () => `Could not change ${row.name}: ${String(err)}`)
  }
  await refresh($)
}

// The toggle on the right. A plugin with a switch of its own is flipped by its
// command and stays loaded; one without is enabled or disabled. Turning on a
// disabled plugin enables it first, then turns its own switch on once loaded.
async function togglePlugin($: $, row: PluginRow) {
  const want = !row.isOn
  if (row.hasSwitch) return runSwitch($, row, want)
  if (want && !row.isEnabled) {
    await setPlugin($, row, true)
    const loaded = (await read($, plugins)).find(p => p.id === row.id)
    if (loaded?.hasSwitch && !loaded.isOn) await runSwitch($, loaded, true)
    return
  }
  await setPlugin($, row, want)
}

async function runSwitch($: $, row: PluginRow, want: boolean) {
  const command = row.id.split('@')[0] ?? row.id
  try {
    await $.command.run({ command, args: want ? 'on' : 'off' })
    await update($, notice, () => `${row.name} turned ${want ? 'on' : 'off'}`)
  } catch (err) {
    await update($, notice, () => `Could not change ${row.name}: ${String(err)}`)
    await refresh($)
    return
  }
  await refresh($)
  // The command answered; its store may land on disk a moment after.
  await update($, plugins, list => list.map(p => (p.id === row.id ? { ...p, isOn: want } : p)))
}

async function setModel($: $, alias: string) {
  try {
    await $.command.run({ command: 'model', args: alias })
    const current = await $.session.model()
    await update($, model, () => current)
  } catch (err) {
    await update($, notice, () => `Could not switch model: ${String(err)}`)
  }
}

async function setEffort($: $, level: string) {
  try {
    await $.command.run({ command: 'effort', args: level })
    await update($, effort, () => level)
  } catch (err) {
    await update($, notice, () => `Could not set effort: ${String(err)}`)
  }
}

export const register: Register = on => {
  let timer: { cancel: () => void } | undefined
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'damons-tools', description: "Open the Damon's Tools panel" })
    const settings = await $.settings.read()
    if (typeof settings.effortLevel === 'string') await update($, effort, () => settings.effortLevel as string)
    await recordRunning($)
    await refresh($)
    // A hide is for one session only; earlier versions saved it for good.
    await $.store.delete('isShown').catch(() => undefined)
    await update($, isShown, () => true)
    void $.ui.open({ id: PANE, title: TITLE })
    timer?.cancel()
    timer = $.clock.every(1500, () => sync($))
    return next(e)
  })

  // A /model or /effort the person types: show it at once, then confirm from the session.
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    await sync($)
    return ran
  })

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const asked = e.args.trim().toLowerCase()
    if ((EFFORTS as readonly string[]).includes(asked)) await update($, effort, () => asked)
    const ran = await next(e)
    await sync($)
    return ran
  })

  // A plugin's own switch typed anywhere (`/automodel off`): redraw its toggle.
  on('command.run', async ($, e, next) => {
    const ran = await next(e)
    const isSwitch = (await read($, plugins)).some(p => p.hasSwitch && p.id.split('@')[0] === e.command)
    if (isSwitch && e.origin?.kind !== 'plugin') await refresh($)
    return ran
  })

  on('command.run', { command: 'damons-tools' }, async $ => {
    await refresh($)
    await setShown($, true)
    return { text: "Damon's Tools opened." }
  })

  // The model and effort actually sent on each main-loop request.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      await update($, model, () => e.model)
      await update($, effort, () => (e.effort === undefined ? null : String(e.effort)))
    }
    return yield* next(e)
  })

  // Context fill and rate limits, as soon as the engine has new figures.
  on('session.measure', async ($, e, next) => {
    await measure($)
    return next(e)
  })

  // Picks up plugins installed or removed since the last look.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await refresh($)
    return next(e)
  })

  // Closing the pane by its own close mark counts as hiding it, for this session.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, isShown, () => false)
    return next(e)
  })

  // The desktop app can attach after the session starts: open the pane for it then.
  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    if (await read($, isShown)) void $.ui.open({ id: PANE, title: TITLE })
    return attached
  })

  // The status bar under the prompt: plan, model, effort, context, 5-hour usage and
  // agents, with the Damon's Tools button on the right in place of each plugin's own
  // (they leave the bar to it while it is installed: it registers /damons-tools).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [shown, current, level, figures, agentCount] = await Promise.all([
      read($, isShown),
      read($, model),
      read($, effort),
      read($, usage),
      read($, agents),
    ])
    const theirs = await next(e).catch(() => null)
    const bar = (key: string) => (
      <Text key={key} dimColor>
        │
      </Text>
    )
    const ctx = figures.contextPercent ?? 0
    const fiveHour = figures.fiveHourPercent
    const window = windowLabel(figures.window)
    return (
      <Box flexDirection="column">
        <Box key="status-bar" flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" columnGap={2}>
            <Text key="plan" color={PLAN}>
              {figures.isSubscription ? 'Subscription' : 'API'}
            </Text>
            {bar('sep-1')}
            <Box key="model" flexDirection="row">
              <Text color={MODEL_MARK}>◆ </Text>
              <Text bold>{current ? modelLabel(current) : '…'}</Text>
              {window !== '' && <Text dimColor> · </Text>}
              {window !== '' && <Text color={MODEL_MARK}>{window}</Text>}
            </Box>
            {bar('sep-2')}
            <Box key="effort" flexDirection="row">
              <Text dimColor>effort </Text>
              <Text color={EFFORT_FG} bold>
                {level ?? '–'}
              </Text>
            </Box>
            {bar('sep-3')}
            <Box key="ctx" flexDirection="row">
              <Text dimColor>ctx </Text>
              <Text color={levelColor(ctx)}>{meter(ctx)}</Text>
              <Text color={levelColor(ctx)} bold>{` ${ctx}%`}</Text>
            </Box>
            {bar('sep-4')}
            <Box key="five-hour" flexDirection="row">
              <Text dimColor>5h </Text>
              {fiveHour === null ? (
                <Text dimColor>–</Text>
              ) : (
                <Text color={levelColor(fiveHour)} bold>{`${fiveHour}%`}</Text>
              )}
            </Box>
            {bar('sep-5')}
            <Text key="agents" dimColor>
              {`◇ ${agentCount} agent${agentCount === 1 ? '' : 's'}`}
            </Text>
          </Box>
          <Box backgroundColor={shown ? ACCENT : OFF_BG} paddingX={1}>
            <Button
              key="dashboard-toggle"
              plain
              label={`◆ Damon's Tools ${shown ? '▾' : '▸'}`}
              onPress={() => setShown($, !shown)}
            />
          </Box>
        </Box>
        {theirs}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [current, level, choices, list, message] = await Promise.all([
      read($, model),
      read($, effort),
      read($, models),
      read($, plugins),
      read($, notice),
    ])
    const fam = familyOf(current)
    const summary = [current ? modelLabel(current) : '…', level ? effortLabel(level) : 'no effort'].join(' · ')

    // The highlighted choice is drawn as a filled chip, not a button: the desktop
    // draws buttons natively and ignores colors set inside them.
    const chip = (key: string, label: string, fill: string) => (
      <Box key={key} backgroundColor={fill} marginRight={1}>
        <Text backgroundColor={fill} color="black" bold>
          {` ${label} `}
        </Text>
      </Box>
    )
    const pick = (key: string, label: string, onPress: () => void) => (
      <Box key={`${key}-box`} marginRight={1}>
        <Button key={key} plain onPress={onPress}>
          {` ${label} `}
        </Button>
      </Box>
    )

    const section = (name: string) => (
      <Box marginTop={1} marginBottom={1}>
        <Text dimColor>── {name.split('').join(' ')}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={ACCENT} bold>
            ◆ D A M O N ' S   T O O L S
          </Text>
          <Text dimColor>{summary}</Text>
        </Box>

        <Box flexDirection="row" marginTop={1}>
          <Box width={10}>
            <Text dimColor>MODEL</Text>
          </Box>
          {choices.map(c => {
            const isCurrent = c.alias === fam
            const label = isCurrent ? modelLabel(current) : `${c.label} ${LATEST[c.alias] ?? ''}`.trim()
            return isCurrent
              ? chip(`model-${c.alias}`, label, ACCENT)
              : pick(`model-${c.alias}`, label, () => setModel($, c.alias))
          })}
        </Box>

        <Box flexDirection="row">
          <Box width={10}>
            <Text dimColor>EFFORT</Text>
          </Box>
          {level === null && current !== '' && <Text dimColor> not used by this model</Text>}
          {(level !== null || current === '') &&
            EFFORTS.map(l => {
              const isCurrent = l === level
              return isCurrent
                ? chip(`effort-${l}`, effortLabel(l), EFFORT_BG)
                : pick(`effort-${l}`, effortLabel(l), () => setEffort($, l))
            })}
        </Box>

        {section('SETTINGS')}

        {list.length === 0 && <Text dimColor>No plugins installed.</Text>}
        {list.map(p => (
          <Box key={`row-${p.id}`} flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row">
              <Text key={`loaded-${p.id}`} color={p.isEnabled ? ON_BG : BAD}>
                {'● '}
              </Text>
              <Text bold={p.isEnabled} dimColor={!p.isEnabled}>
                {p.name}
              </Text>
              <Text dimColor>{p.description ? `  ${p.description}` : ''}</Text>
            </Box>
            <Box flexDirection="row">
            {p.isPending && (
              <Box marginRight={1}>
                <Text color={PENDING}>⟳ pending · next session</Text>
              </Box>
            )}
            <Box
              key={`switch-${p.id}`}
              backgroundColor={p.isOn ? ON_BG : TOGGLE_OFF}
              borderStyle="round"
              borderColor={p.isOn ? ON_BG : TOGGLE_OFF}
            >
              <Button key={`toggle-${p.id}`} plain onPress={() => togglePlugin($, p)}>
                {p.isOn ? ' ● On  ' : ' ○ Off '}
              </Button>
            </Box>
            </Box>
          </Box>
        ))}

        <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
          <Text dimColor>{message ?? ''}</Text>
          <Button key="refresh" plain dimColor onPress={() => refresh($)}>
            Refresh
          </Button>
        </Box>
      </Box>
    )
  })
}
