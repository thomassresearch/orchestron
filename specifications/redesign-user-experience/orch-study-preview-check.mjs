#!/usr/bin/env node
/**
 * Check the standalone Orchestron workspace study without starting the app.
 *
 *   node specifications/redesign-user-experience/orch-study-preview-check.mjs
 *   node specifications/redesign-user-experience/orch-study-preview-check.mjs \
 *     --source /path/to/study.html --output /tmp/orch-study-check
 *
 * Requires an existing Playwright installation and Chromium. Nothing is installed
 * automatically. PLAYWRIGHT_MODULE can point to an installed package or its entry
 * file; PLAYWRIGHT_EXECUTABLE_PATH can select an existing Chromium executable.
 */
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, isAbsolute, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../..');
const help = `Usage: node orch-study-preview-check.mjs [options]

  --source PATH    HTML fragment or standalone HTML (default: sibling study)
  --output PATH    Screenshot/report directory (default: output/playwright/redesign-user-experience)
  --width NUMBER   Desktop browser width in pixels (default: 1048)
  --height NUMBER  Desktop browser height in pixels (default: 820)
  --theme VALUE   dark or light (default: dark)
  --headed        Show the preview browser
  --help          Show this help

Environment:
  PLAYWRIGHT_MODULE           Existing Playwright package or entry-file path
  PLAYWRIGHT_EXECUTABLE_PATH  Existing Chromium executable

No application server, audio engine, network API, or package installation is used.
`;

function optionsFrom(args) {
  const options = {
    source: resolve(here, 'orchestron-studio-study.html'),
    output: resolve(repository, 'output/playwright/redesign-user-experience'),
    width: 1048,
    height: 820,
    theme: 'dark',
    headed: false,
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') return null;
    if (flag === '--headed') {
      options.headed = true;
      continue;
    }
    if (!['--source', '--output', '--width', '--height', '--theme'].includes(flag)) {
      throw new Error(`Unknown option: ${flag}\n${help}`);
    }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    const key = flag.slice(2);
    options[key] = ['width', 'height'].includes(key) ? Number(value) : value;
  }
  for (const key of ['width', 'height']) {
    if (!Number.isInteger(options[key]) || options[key] < 320) {
      throw new Error(`--${key} must be an integer of at least 320 pixels`);
    }
  }
  if (!['dark', 'light'].includes(options.theme)) throw new Error('--theme must be dark or light');
  options.source = resolve(options.source);
  options.output = resolve(options.output);
  return options;
}

async function loadPlaywright() {
  const localRequire = createRequire(import.meta.url);
  const frontendRequire = createRequire(resolve(repository, 'frontend/package.json'));
  const override = process.env.PLAYWRIGHT_MODULE;
  const attempts = [];
  if (override) {
    const target = override.startsWith('.') || isAbsolute(override) ? resolve(override) : override;
    try {
      const module = await import(pathToFileURL(localRequire.resolve(target)).href);
      if (!module.chromium) throw new Error('Module does not export chromium');
      return module;
    } catch (error) {
      throw new Error(`Cannot load PLAYWRIGHT_MODULE=${override}: ${error.message}`);
    }
  }
  for (const requireFrom of [localRequire, frontendRequire]) {
    for (const packageName of ['playwright', 'playwright-core']) {
      try {
        const module = await import(pathToFileURL(requireFrom.resolve(packageName)).href);
        if (module.chromium) return module;
      } catch (error) {
        attempts.push(error.code || error.message);
      }
    }
  }
  throw new Error('Playwright was not found. Use an existing installation via '
    + 'PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs, or make playwright '
    + 'available to this repository. Nothing was installed. '
    + `Resolution results: ${[...new Set(attempts)].join(', ')}`);
}

async function run(options) {
  let source;
  try {
    source = await readFile(options.source, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read study ${options.source}: ${error.message}. Use --source to select another study.`);
  }
  const {chromium} = await loadPlaywright();
  await mkdir(options.output, {recursive: true});
  const launchOptions = {headless: !options.headed};
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  }
  const browser = await chromium.launch(launchOptions);
  const report = {source: options.source, viewport: {width: options.width, height: options.height}, layouts: [], widths: [], errors: []};
  let page;
  try {
    page = await browser.newPage({viewport: report.viewport, colorScheme: options.theme});
    page.on('pageerror', error => report.errors.push(error.message));
    // The study is self-contained. Fail closed on accidental remote dependencies.
    await page.route(/^https?:/, route => route.abort());
    const background = options.theme === 'dark' ? '#080f1d' : '#f0f4f9';
    const documentSource = /<!doctype|<html[\s>]/i.test(source) ? source
      : `<html style="color-scheme:${options.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:12px;background:${background}">${source}</body></html>`;
    // Standards mode is essential: quirks-mode body height plus margins can
    // introduce document scrolling even when the workspace itself fits.
    const html = /<!doctype\s+html/i.test(documentSource) ? documentSource : `<!doctype html>${documentSource}`;
    await page.setContent(html, {waitUntil: 'domcontentloaded'});
    const app = page.locator('#orch-studio');
    await app.waitFor({state: 'visible'});
    const sizePreview = async (width, height) => {
      await page.setViewportSize({width, height});
      await app.evaluate(async (element, availableHeight) => {
        element.style.setProperty('--studio-height', `${availableHeight}px`);
        // Let layout and ResizeObserver-driven responsive state settle before
        // measuring visibility. This follows rendering rather than wall time.
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      }, height - 24);
    };
    await sizePreview(options.width, options.height);
    const screenshot = name => app.screenshot({path: resolve(options.output, `${name}.png`)});
    const action = name => page.locator(`[data-action="${name}"]`).first();
    const setPanel = async (name, open) => {
      const button = action(name);
      if ((await button.getAttribute('aria-pressed') === 'true') !== open) await button.click();
    };
    const bounds = async () => app.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return {top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height,
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
        viewportHeight: window.innerHeight, documentHeight: document.documentElement.scrollHeight};
    });
    const desktopFits = async () => {
      const geometry = await bounds();
      const details = JSON.stringify(geometry);
      assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `Desktop study overflows horizontally: ${details}`);
      assert.ok(geometry.bottom <= geometry.viewportHeight + 1, `Desktop study extends below the browser viewport: ${details}`);
      assert.ok(geometry.documentHeight <= geometry.viewportHeight + 1, `Desktop page scrolls outside its workspace: ${details}`);
      return geometry;
    };

    const splitter = page.getByRole('separator', {name: 'Detail editor', exact: true});
    assert.equal(await page.locator('#o-height').count(), 0, 'The old editor-height slider is still present');
    const editorHeight = async () => (await page.locator('#o-detail').boundingBox()).height;
    const dragDivider = async (delta, {cancel = false, outside = false} = {}) => {
      const box = await splitter.boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(outside ? box.x - 30 : x, y + delta, {steps: 6});
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
    };
    const layoutControl = page.locator('[data-field="layout"]');
    assert.equal(await layoutControl.count(), 1, 'Expected one Arrange layout selector');
    for (const layout of ['Timeline above', 'Timeline below']) {
      await layoutControl.selectOption({label: layout});
      await setPanel('editor', true);
      assert.equal(await page.locator('#o-detail').isVisible(), true, `${layout}: editor must be open`);
      const main = await page.locator('#o-main').boundingBox();
      const detail = await page.locator('#o-detail').boundingBox();
      assert.ok(main && detail, `${layout}: arrangement and editor must be visible`);
      assert.ok(layout === 'Timeline above' ? main.y < detail.y : detail.y < main.y,
        `${layout}: panel order does not match selection: ${JSON.stringify({main, detail})}`);
      report.layouts.push({layout, bounds: await desktopFits()});
      await screenshot(layout === 'Timeline above' ? 'arrange-timeline-above' : 'arrange-timeline-below');

      const direction = layout === 'Timeline above' ? -1 : 1;
      const initialHeight = await editorHeight();
      const statusBefore = await page.locator('#o-save-status').textContent();
      const selectionBefore = await page.locator('.o-clip.o-selected').getAttribute('aria-label');
      const contentBefore = await page.locator('.o-detail-body').innerHTML();
      const rulerBefore = await page.locator('.o-ruler').boundingBox();
      await dragDivider(direction * 50, {outside: true});
      assert.ok(Math.abs(await editorHeight() - initialHeight - 50) < 2, `${layout}: dragging outside the handle should resize the editor by 50px`);
      assert.equal(await splitter.evaluate(el => document.activeElement === el), true, 'Divider loses keyboard focus after dragging');
      if (layout === 'Timeline above') {
        assert.equal((await page.locator('.o-ruler').boundingBox()).y, rulerBefore.y, 'Dragging moves the song ruler');
      }
      const resizedHeight = await editorHeight();
      await dragDivider(direction * 24, {cancel: true});
      assert.ok(Math.abs(await editorHeight() - resizedHeight) < 2, 'Escape does not restore the split before dragging');
      assert.equal(await app.evaluate(el => el.classList.contains('o-resizing')), false, 'Cancelled drag leaves resize state active');

      await splitter.press('ArrowUp');
      assert.ok(Math.abs(await editorHeight() - resizedHeight + direction * 10) < 2, 'Up arrow should move the divider upward by 10px');
      const keyboardHeight = await editorHeight();
      await splitter.press('Shift+ArrowDown');
      assert.ok(Math.abs(await editorHeight() - keyboardHeight - direction) < 1, 'Shift+arrow should resize by 1px');
      await splitter.press('Home');
      assert.ok(Math.abs(await editorHeight() - Number(await splitter.getAttribute('aria-valuemin'))) < 1, 'Home does not reach the minimum editor height');
      await dragDivider(-direction * 600);
      assert.ok(Math.abs(await editorHeight() - Number(await splitter.getAttribute('aria-valuemin'))) < 1, 'Dragging can shrink past the minimum');
      await splitter.press('End');
      const maximum = Number(await splitter.getAttribute('aria-valuemax'));
      assert.ok(Math.abs(await editorHeight() - maximum) < 1, 'End does not reach the maximum editor height');
      await dragDivider(direction * 600);
      assert.ok(Math.abs(await editorHeight() - maximum) < 1, 'Dragging can grow past the available space');
      assert.equal(Number(await splitter.getAttribute('aria-valuenow')), Math.round(await editorHeight()), 'Accessible splitter value is out of sync');
      assert.equal(await page.locator('#o-save-status').textContent(), statusBefore, 'Resizing dirties the performance');
      assert.equal(await page.locator('.o-clip.o-selected').getAttribute('aria-label'), selectionBefore, 'Resizing changes clip selection');
      assert.equal(await page.locator('.o-detail-body').innerHTML(), contentBefore, 'Resizing rebuilds or changes the editor contents');
      await setPanel('editor', false);
      await setPanel('editor', true);
      assert.ok(Math.abs(await editorHeight() - maximum) < 1, 'Reopening loses the chosen editor height');
      await desktopFits();
      await screenshot(layout === 'Timeline above' ? 'arrange-divider-resized' : 'arrange-divider-below-resized');
      await splitter.press('Home');
      for (let step = 0; step < 4; step++) await splitter.press(direction === -1 ? 'ArrowUp' : 'ArrowDown');
    }
    report.splitter = {pointerDrag: 'passed', outsideHandle: 'passed', escapeCancel: 'passed', keyboard: 'passed', limits: 'passed', preservedState: 'passed'};

    await setPanel('editor', false);
    await setPanel('inspector', false);
    assert.equal(await page.locator('#o-detail').isVisible(), false, 'Closed editor is still visible');
    assert.equal(await page.locator('.o-divider').isVisible(), false, 'Closed editor leaves a splitter behind');
    const closed = await app.evaluate(element => {
      const main = element.querySelector('#o-main').getBoundingClientRect();
      const work = element.querySelector('.o-work').getBoundingClientRect();
      const footer = element.querySelector('.o-timeline-footer').getBoundingClientRect();
      return {mainHeight: main.height, workHeight: work.height,
        reservedBelowMain: work.bottom - main.bottom, emptyBelowTimeline: main.bottom - footer.bottom};
    });
    assert.ok(closed.reservedBelowMain <= 2, `Closing all panels leaves reserved editor space: ${JSON.stringify(closed)}`);
    assert.ok(closed.emptyBelowTimeline <= 12, `Arrangement footer leaves a dead region below the timeline: ${JSON.stringify(closed)}`);
    report.closedPanels = closed;
    const filledBounds = await desktopFits();
    await screenshot('arrange-panels-closed');

    // The embeddable alternative should collapse to its content when tools close.
    await app.evaluate(element => element.classList.add('o-compact-preview'));
    const compactBounds = await bounds();
    assert.ok(compactBounds.height < filledBounds.height - 16,
      `Content-height preview does not shrink when its panels are closed: ${JSON.stringify({filledBounds, compactBounds})}`);
    report.compactPreview = compactBounds;
    await screenshot('arrange-compact-panels-closed');
    await app.evaluate(element => element.classList.remove('o-compact-preview'));

    await action('keyboard').click();
    assert.equal(await page.locator('#o-detail').isVisible(), true, 'Keyboard toggle does not open its dock');
    await screenshot('arrange-keyboard');
    await action('keyboard').click();
    assert.equal(await page.locator('#o-detail').isVisible(), false, 'Second keyboard toggle does not close its dock');
    assert.equal(await page.locator('.o-divider').isVisible(), false, 'Closed keyboard leaves a splitter behind');
    await desktopFits();

    await page.locator('[data-action="view"][data-view="mix"]').click();
    await screenshot('mix');
    await page.locator('[data-action="view"][data-view="live"]').click();
    await page.locator('[data-action="device"][data-track="4"]').click();
    await page.locator('[data-action="pad"][data-track="4"][data-pad="3"]').click();
    assert.equal(await page.locator('.o-queued').count(), 1, 'Queued pad missing');
    await action('boundary').click();
    assert.match(await page.locator('[data-track="4"][data-pad="3"]').textContent(), /PLAYING/, 'Pad launch missing');
    await action('keyboard').click();
    await screenshot('live-keyboard');
    await page.locator('[data-action="view"][data-view="arrange"]').click();

    for (const {width, height, scenario} of [
      {width: 1280, height: 720},
      {width: 1440, height: 900},
      {width: 736, height: 720},
      {width: 390, height: 844},
      {width: 640, height: 360, scenario: '200% zoom equivalent effective viewport'},
    ]) {
      await sizePreview(width, height);
      const geometry = await bounds();
      assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `${width}px study overflows horizontally: ${JSON.stringify(geometry)}`);
      if (width >= 700) await desktopFits();
      else {
        const overviewVisible = await page.locator('#o-main').isVisible();
        const detailVisible = await page.locator('#o-detail').isVisible();
        assert.notEqual(overviewVisible, detailVisible, 'Narrow layout should show one working pane at a time');
        assert.equal(await splitter.isVisible(), false, 'Single-pane layout must hide the divider');
      }
      report.widths.push({viewportWidth: width, viewportHeight: height, ...(scenario ? {scenario} : {}), ...geometry});
      await screenshot(`viewport-${width}x${height}`);
    }
    assert.deepEqual(report.errors, [], 'Browser script errors occurred');
    report.result = 'passed';
    console.log(JSON.stringify(report, null, 2));
    console.log(`Screenshots and report: ${options.output}`);
  } catch (error) {
    report.result = 'failed';
    report.failure = error.message;
    if (page && !page.isClosed()) {
      try {
        const failurePath = resolve(options.output, 'failure.png');
        await page.screenshot({path: failurePath, fullPage: true});
        report.failureScreenshot = failurePath;
      } catch (screenshotError) {
        report.failureScreenshotError = screenshotError.message;
      }
    }
    throw error;
  } finally {
    await writeFile(resolve(options.output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
  }
}

try {
  const options = optionsFrom(process.argv.slice(2));
  if (!options) console.log(help);
  else await run(options);
} catch (error) {
  console.error(`Preview check failed: ${error.message}`);
  process.exitCode = 1;
}
