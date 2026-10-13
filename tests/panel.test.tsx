import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = { title: "Damon's Tools", isFocused: false, bodyColumns: 80, seat: 'dock' } as const

test('draws the header, model and effort rows, and a settings section', async $ => {
  const ui = await $.ui.mount({
    plugin: 'damons-tools',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'damons-tools',
    props: PANE as never,
  })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(texts).toContain("D A M O N ' S")
  expect(texts).toContain('MODEL')
  expect(texts).toContain('EFFORT')
  expect(texts).toContain('S E T T I N G S')
  expect(await ui.find({ key: 'model-opus' })).toBeDefined()
  expect(await ui.find({ key: 'model-fable' })).toBeDefined()
  expect(await ui.find({ key: 'effort-xhigh' })).toBeDefined()
  expect(await ui.find({ key: 'refresh' })).toBeDefined()
})


test('the bar under the prompt has one button that hides and shows the dashboard', async ($, on) => {
  mock.store(on)
  const panes: string[] = []
  on('ui.close', ($, e) => (panes.push(`close ${e.id}`), { value: undefined }))
  on('ui.open', ($, e) => (panes.push(`open ${e.id}`), { value: { isPlaced: true } }))
  const ui = await $.ui.mount({
    plugin: 'damons-tools',
    surface: 'desktop',
    component: 'SessionMode',
    props: { modes: [] },
  })
  expect((await ui.find({ key: 'dashboard-toggle' }))?.text).toBe("◆ Damon's Tools ▾")
  await ui.press({ key: 'dashboard-toggle' })
  expect((await ui.find({ key: 'dashboard-toggle' }))?.text).toBe("◆ Damon's Tools ▸")
  await ui.press({ key: 'dashboard-toggle' })
  expect((await ui.find({ key: 'dashboard-toggle' }))?.text).toBe("◆ Damon's Tools ▾")
  expect(panes).toEqual(['close damons-tools', 'open damons-tools'])
})

test('the status bar shows plan, model, effort, context, 5-hour usage and agents', async $ => {
  const ui = await $.ui.mount({
    plugin: 'damons-tools',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes: [] },
  })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')
  expect(texts).toContain('effort')
  expect(texts).toContain('ctx')
  expect(texts).toContain('▱▱▱▱▱▱▱▱▱▱')
  expect(texts).toContain('5h')
  expect(texts).toContain('◇ 0 agents')
  expect(texts).toMatch(/Subscription|API/)
  expect(await ui.find({ key: 'dashboard-toggle' })).toBeDefined()
})

// Three plugins: one with its own switch (off), one with its own switch (on), one disabled without one.
function plugins(on: On) {
  mock.store(on)
  const ran: string[] = []
  const written: string[] = []
  const HOME = 'C:/Users/me'
  const files: Record<string, string> = {
    [`${HOME}/.claude/plugins/installed_plugins.json`]: JSON.stringify({
      plugins: {
        'automodel@automodel': [{ installPath: 'C:/x/automodel' }],
        'clean-view@clean-view': [{ installPath: 'C:/x/clean-view' }],
        'watch@claude-video': [{ installPath: 'C:/x/watch' }],
      },
    }),
    [`${HOME}/.claude/plugins/store/automodel_automodel-4b8f.json`]: JSON.stringify({ isOn: false }),
    [`${HOME}/.claude/plugins/store/clean-view_clean-view-d45d.json`]: JSON.stringify({ isOn: true }),
    [`${HOME}/.claude/settings.json`]: JSON.stringify({ enabledPlugins: { 'watch@claude-video': false } }),
  }
  const enabled = { 'automodel@automodel': true, 'clean-view@clean-view': true, 'watch@claude-video': false }
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? HOME : undefined }))
  on('fs.read', ($, e) => {
    const text = files[e.path.replace(/\\/g, '/')]
    if (text === undefined) throw new Error(`no file ${e.path}`)
    return { value: text }
  })
  on('fs.write', ($, e) => (written.push(e.text), { value: undefined }))
  on('fs.list', () => ({
    value: ['automodel_automodel-4b8f.json', 'clean-view_clean-view-d45d.json'].map(name => ({
      name,
      kind: 'file' as const,
      size: 10,
      mtimeMs: 0,
      isLink: false,
    })),
  }))
  on('settings.read', () => ({ value: { enabledPlugins: enabled } }))
  on('command.list', () => ({
    value: ['automodel', 'clean-view', 'simple'].map(name => ({ name, description: '' })) as never,
  }))
  // A plugin's switch command saves `isOn` to its store, as the real ones do.
  on('command.run', ($, e) => {
    ran.push(`${e.command} ${e.args}`.trim())
    const store = Object.keys(files).find(path => path.includes(`/store/${e.command}_`))
    if (store && (e.args === 'on' || e.args === 'off')) files[store] = JSON.stringify({ isOn: e.args === 'on' })
    return { text: 'done' }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('config.list', () => ({ value: [] }))
  mock.clock(on, { now: 1_000_000 })
  return { ran, written }
}

test('each plugin row has a loaded dot and a toggle for its own switch', async ($, on) => {
  const seen = plugins(on)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'damons-tools',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'damons-tools',
    props: PANE as never,
  })
  // Rows sort by name: Automodel, Clean View, Watch.
  const dots = async () =>
    (await ui.findAll({ type: 'Text' })).filter(t => t.text === '● ').map(t => t.props.color)
  const toggles = async () =>
    (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('toggle-')).map(b => b.text.trim())

  expect(await dots()).toEqual(['#2bb673', '#2bb673', '#e5534b'])
  expect(await toggles()).toEqual(['○ Off', '● On', '○ Off'])

  // Its own switch: the command under its name, and it stays loaded.
  await ui.press({ key: 'toggle-automodel@automodel' })
  await ui.press({ key: 'toggle-clean-view@clean-view' })
  expect(seen.ran).toEqual(['automodel on', 'clean-view off'])
  expect(seen.written).toEqual([])
  expect(await toggles()).toEqual(['● On', '○ Off', '○ Off'])
  expect(await dots()).toEqual(['#2bb673', '#2bb673', '#e5534b'])

  // No switch of its own and not loaded: enabled, then plugins reloaded.
  await ui.press({ key: 'toggle-watch@claude-video' })
  expect(seen.written.some(text => JSON.parse(text).enabledPlugins['watch@claude-video'] === true)).toBe(true)
  expect(seen.ran).toContain('reload-plugins')
  await ui.unmount()
})
