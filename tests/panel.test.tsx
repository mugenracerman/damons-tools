import { expect, mock, test } from 'claude-code/testing'

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
