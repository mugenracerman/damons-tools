import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModelChoice, PluginRow, Running } from '../types'

const PANE = 'damons-tools'
const TITLE = "Damon's Tools"

const ACCENT = '#e8875b'
const EFFORT_BG = '#a06a9a'
const ON_BG = '#2bb673'
const OFF_BG = '#3a3a3a'
const PENDING = '#e0b341'

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

  const rows = await Promise.all(
    Object.entries(installed).map(async ([id, installs]) => {
      const name = id.split('@')[0] ?? id
      let description = ''
      const path = installs?.[0]?.installPath
      if (path) {
        try {
          const manifest = JSON.parse(await $.fs.read(`${path.replace(/\\/g, '/')}/.claude-plugin/plugin.json`))
          description = manifest.description ?? ''
        } catch {}
      }
      const isEnabled = enabled[id] !== false
      const isPending = id in live && live[id] !== isEnabled
      return { id, name: titleCase(name), description: shorten(description), isEnabled, isPending }
    }),
  )
  return rows.sort((a, b) => a.name.localeCompare(b.name))
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

// Shows or hides the dashboard; the choice is kept for later sessions.
async function setShown($: $, shown: boolean) {
  await update($, isShown, () => shown)
  await $.store.set('isShown', shown)
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
    const shown = (await $.store.get('isShown')) !== false
    await update($, isShown, () => shown)
    if (shown) void $.ui.open({ id: PANE, title: TITLE })
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

  // Picks up plugins installed or removed since the last look.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await refresh($)
    return next(e)
  })

  // Closing the pane by its own close mark counts as hiding it.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      await update($, isShown, () => false)
      await $.store.set('isShown', false)
    }
    return next(e)
  })

  // One button in the bar under the prompt, in place of each plugin's own: they
  // leave the bar to the dashboard while it is installed (it registers /damons-tools).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const { Box, Button } = $.ui.resolve(e)
    const shown = await read($, isShown)
    const theirs = await next(e).catch(() => null)
    return (
      <Box flexDirection="row" columnGap={1}>
        <Box backgroundColor={shown ? ACCENT : OFF_BG} paddingX={1}>
          <Button
            key="dashboard-toggle"
            plain
            label={`Dashboard: ${shown ? 'Shown' : 'Hidden'}`}
            onPress={() => setShown($, !shown)}
          />
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
              <Text color={p.isEnabled ? ON_BG : undefined} dimColor={!p.isEnabled}>
                {p.isEnabled ? '● ' : '○ '}
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
              backgroundColor={p.isEnabled ? ON_BG : OFF_BG}
              borderStyle="round"
              borderColor={p.isEnabled ? ON_BG : OFF_BG}
            >
              <Button key={`toggle-${p.id}`} plain onPress={() => setPlugin($, p, !p.isEnabled)}>
                {p.isEnabled ? ' ● On  ' : ' ○ Off '}
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
