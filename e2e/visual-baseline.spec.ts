// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const COMMIT_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function dynamicMasks(page: Page) {
  return [
    page.locator('.avatar'),
    page.locator('.agent-avatar'),
    page.locator('.ft-date'),
    page.locator('.ft-meta'),
    page.locator('.cl-by .no-wrap'),
    page.locator('.cb-who > .muted'),
    page.locator('.about .ticks li:last-child'),
    page.locator('time'),
  ];
}

test.beforeEach(async ({ page }, testInfo) => {
  const mode = testInfo.project.name.includes('dark') ? 'dark' : 'light';
  await page.addInitScript((themeMode) => {
    window.localStorage.setItem('go-mode', themeMode);
    window.localStorage.setItem('go-lang', 'en');
    const fixedNow = new Date('2026-11-01T12:00:00.000Z').getTime();
    Date.now = () => fixedNow;
  }, mode);
});

async function stabilizePage(page: Page, selector: string) {
  await page.mouse.move(1270, 790);
  await page
    .locator(selector)
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(260);
}

async function assertNoCriticalAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter((v) => v.impact === 'critical');
  expect(
    critical,
    `Critical axe-core violations: ${JSON.stringify(
      critical.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.length }))
    )}`
  ).toEqual([]);
}

async function verifyKeyboardFocusTraversal(
  page: Page,
  expectedFocusColor: string,
  steps = 12
) {
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    const focusInfo = await page.evaluate((step) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) {
        return null;
      }
      const selfStyle = getComputedStyle(el);
      const wrapper = el.closest(
        '.gsearch, .watch-select'
      ) as HTMLElement | null;
      const wrapperStyle = wrapper ? getComputedStyle(wrapper) : null;
      const useWrapper =
        selfStyle.outlineStyle === 'none' &&
        wrapperStyle &&
        wrapperStyle.outlineStyle !== 'none';
      const activeStyle = useWrapper ? wrapperStyle! : selfStyle;
      return {
        step,
        tag: el.tagName,
        id: el.id,
        cls: el.className,
        outlineStyle: activeStyle.outlineStyle,
        outlineWidth: activeStyle.outlineWidth,
        outlineColor: activeStyle.outlineColor,
      };
    }, i);
    expect(focusInfo).not.toBeNull();
    expect(focusInfo!.outlineStyle, JSON.stringify(focusInfo)).toBe('solid');
    expect(focusInfo!.outlineWidth, JSON.stringify(focusInfo)).toBe('2px');
    expect(focusInfo!.outlineColor, JSON.stringify(focusInfo)).toBe(
      expectedFocusColor
    );
  }
}

test.describe('CloudForge Visual Baseline (6 Core Git Scenarios)', () => {
  test('01 - Repository Home (仓库首页)', async ({ page }, testInfo) => {
    await page.goto('/acme/cloudforge', { waitUntil: 'networkidle' });
    await stabilizePage(page, '.filetable');
    await stabilizePage(page, '.readme .md h1');

    const isDark = testInfo.project.name.includes('dark');
    const shellTokens = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const topnav = getComputedStyle(document.querySelector('.topnav')!);
      const content = getComputedStyle(document.querySelector('.content')!);
      const activeTab = getComputedStyle(
        document.querySelector('.rtabs a[aria-current="page"]')!
      );
      const viewContainer = getComputedStyle(
        document.querySelector('.content > .view')!
      );
      return {
        bodyFontSize: body.fontSize,
        topnavBg: topnav.backgroundColor,
        contentBg: content.backgroundColor,
        activeTabBorder: activeTab.borderBottomColor,
        viewMaxWidth: viewContainer.maxWidth,
      };
    });

    expect(shellTokens.bodyFontSize).toBe('14px');
    expect(shellTokens.viewMaxWidth).toBe('1280px');
    if (isDark) {
      expect(shellTokens.topnavBg).toBe('rgb(1, 4, 9)');
      expect(shellTokens.contentBg).toBe('rgb(13, 17, 23)');
      expect(shellTokens.activeTabBorder).toBe('rgb(47, 129, 247)');
    } else {
      expect(shellTokens.topnavBg).toBe('rgb(246, 248, 250)');
      expect(shellTokens.contentBg).toBe('rgb(255, 255, 255)');
      expect(shellTokens.activeTabBorder).toBe('rgb(9, 105, 218)');
    }

    await expect(page).toHaveScreenshot('01-repo-home.png', {
      animations: 'disabled',
      maxDiffPixels: 0,
      mask: dynamicMasks(page),
    });

    // Checkpoint 4 verification: axe-core 0 critical violations & keyboard focus ring traversal
    await assertNoCriticalAxeViolations(page);
    const expectedFocusColor = isDark
      ? 'rgb(47, 129, 247)'
      : 'rgb(9, 105, 218)';
    await verifyKeyboardFocusTraversal(page, expectedFocusColor, 14);
    await page.locator('.codebar .btn').first().focus();
    await page.screenshot({
      path: `test-results/focus-ring-${isDark ? 'dark' : 'light'}.png`,
      animations: 'disabled',
    });
  });

  test('02 - File Tree Subdirectory (文件树)', async ({ page }) => {
    await page.goto('/acme/cloudforge/tree/main/src/components', {
      waitUntil: 'networkidle',
    });
    await stabilizePage(page, '.filetable');

    // Verify no horizontal overflow at 1280px and GitHub-style ellipsis truncation on long filenames
    const metrics1280 = await page.evaluate(() => {
      const table = document.querySelector<HTMLElement>('.filetable')!;
      const longName = Array.from(
        document.querySelectorAll<HTMLElement>('.ft-name-text')
      ).find((el) => el.textContent?.includes('VirtualizedUnified'));
      const style = longName ? getComputedStyle(longName) : null;
      return {
        tableOverflows: table.scrollWidth > table.clientWidth,
        textOverflow: style?.textOverflow,
        overflow: style?.overflow,
        whiteSpace: style?.whiteSpace,
        isTruncated: longName
          ? longName.scrollWidth > longName.clientWidth
          : false,
      };
    });
    expect(metrics1280.tableOverflows).toBe(false);
    expect(metrics1280.textOverflow).toBe('ellipsis');
    expect(metrics1280.overflow).toBe('hidden');
    expect(metrics1280.whiteSpace).toBe('nowrap');
    expect(metrics1280.isTruncated).toBe(true);

    // Verify no horizontal overflow at 1920px baseline viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    const metrics1920 = await page.evaluate(() => {
      const table = document.querySelector<HTMLElement>('.filetable')!;
      const view = document.querySelector<HTMLElement>('.content > .view')!;
      return {
        tableOverflows: table.scrollWidth > table.clientWidth,
        viewWidth: view.getBoundingClientRect().width,
      };
    });
    expect(metrics1920.tableOverflows).toBe(false);
    expect(metrics1920.viewWidth).toBeLessThanOrEqual(1280);

    // Restore 1280x800 for baseline snapshot comparison
    await page.setViewportSize({ width: 1280, height: 800 });
    await stabilizePage(page, '.filetable');

    await expect(page).toHaveScreenshot('02-file-tree.png', {
      animations: 'disabled',
      maxDiffPixels: 0,
      mask: dynamicMasks(page),
    });
    await assertNoCriticalAxeViolations(page);
  });

  test('03 - File Blob View (文件查看页)', async ({ page }) => {
    await page.goto('/acme/cloudforge/blob/main/src/git/service.ts', {
      waitUntil: 'networkidle',
    });
    await stabilizePage(page, '.filebox .code-t .hljs-keyword');

    await expect(page).toHaveScreenshot('03-file-blob.png', {
      animations: 'disabled',
      maxDiffPixels: 0,
      mask: dynamicMasks(page),
    });
    await assertNoCriticalAxeViolations(page);
  });

  test('04 - Commit History Timeline (提交历史)', async ({
    page,
  }, testInfo) => {
    await page.goto('/acme/cloudforge/commits/main', {
      waitUntil: 'networkidle',
    });
    await stabilizePage(page, '.commit-days');

    await expect(page).toHaveScreenshot('04-commit-history.png', {
      animations: 'disabled',
      maxDiffPixels: 0,
      mask: dynamicMasks(page),
    });
    await assertNoCriticalAxeViolations(page);
    const isDark = testInfo.project.name.includes('dark');
    await verifyKeyboardFocusTraversal(
      page,
      isDark ? 'rgb(47, 129, 247)' : 'rgb(9, 105, 218)',
      12
    );
  });

  test('05 - Single Commit Diff (单次提交 diff)', async ({
    page,
  }, testInfo) => {
    await page.goto(`/acme/cloudforge/commit/${COMMIT_SHA}`, {
      waitUntil: 'networkidle',
    });
    await stabilizePage(page, '.diff-list');

    // Checkpoint 3 verification: Diff addition/deletion backgrounds match DESIGN.md success.subtle / danger.subtle and pass WCAG contrast
    const diffMetrics = await page.evaluate(() => {
      const addCell = document.querySelector('.diff-table .da .dc')!;
      const delCell = document.querySelector('.diff-table .dd .dc')!;
      const hunkCell = document.querySelector('.diff-table .dh .dc')!;
      const oldGutter = document.querySelector('.diff-table .dn-old')!;
      const newGutter = document.querySelector('.diff-table .dn-new')!;
      const hunkToggle = document.querySelector('.diff-hunk-toggle');
      const canvasBg = getComputedStyle(
        document.querySelector('.diff-file')!
      ).backgroundColor;

      function parseRgba(str: string): [number, number, number, number] {
        const m = str.match(
          /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/
        );
        if (!m) return [0, 0, 0, 1];
        return [
          Number(m[1]),
          Number(m[2]),
          Number(m[3]),
          m[4] !== undefined ? Number(m[4]) : 1,
        ];
      }

      function composite(
        fg: [number, number, number, number],
        bg: [number, number, number, number]
      ): [number, number, number] {
        const a = fg[3];
        return [
          Math.round(fg[0] * a + bg[0] * (1 - a)),
          Math.round(fg[1] * a + bg[1] * (1 - a)),
          Math.round(fg[2] * a + bg[2] * (1 - a)),
        ];
      }

      function relLum([r, g, b]: [number, number, number]): number {
        const f = (c: number) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      }

      function contrastRatio(
        rgb1: [number, number, number],
        rgb2: [number, number, number]
      ): number {
        const l1 = relLum(rgb1);
        const l2 = relLum(rgb2);
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
      }

      const addStyle = getComputedStyle(addCell);
      const delStyle = getComputedStyle(delCell);
      const hunkStyle = getComputedStyle(hunkCell);
      const baseRgb = parseRgba(canvasBg);
      const addBgRgb = composite(parseRgba(addStyle.backgroundColor), baseRgb);
      const delBgRgb = composite(parseRgba(delStyle.backgroundColor), baseRgb);
      const addFgRgb = composite(parseRgba(addStyle.color), addBgRgb);
      const delFgRgb = composite(parseRgba(delStyle.color), delBgRgb);

      return {
        addBg: addStyle.backgroundColor,
        delBg: delStyle.backgroundColor,
        hunkBg: hunkStyle.backgroundColor,
        addContrast: contrastRatio(addFgRgb, addBgRgb),
        delContrast: contrastRatio(delFgRgb, delBgRgb),
        oldGutterWidth: getComputedStyle(oldGutter).width,
        newGutterWidth: getComputedStyle(newGutter).width,
        hasHunkToggle: !!hunkToggle,
      };
    });

    expect(diffMetrics.oldGutterWidth).toBe('50px');
    expect(diffMetrics.newGutterWidth).toBe('50px');
    expect(diffMetrics.hasHunkToggle).toBe(true);
    expect(diffMetrics.addContrast).toBeGreaterThanOrEqual(4.5);
    expect(diffMetrics.delContrast).toBeGreaterThanOrEqual(4.5);

    if (testInfo.project.name === 'chromium-light') {
      expect(diffMetrics.addBg).toBe('rgb(218, 251, 225)'); // #dafbe1 (success.subtle)
      expect(diffMetrics.delBg).toBe('rgb(255, 235, 233)'); // #ffebe9 (danger.subtle)
      expect(diffMetrics.hunkBg).toBe('rgb(221, 244, 255)'); // #ddf4ff (accent.subtle)
    } else {
      expect(diffMetrics.addBg).toBe('rgba(46, 160, 67, 0.15)'); // success.subtle
      expect(diffMetrics.delBg).toBe('rgba(248, 81, 73, 0.15)'); // danger.subtle
      expect(diffMetrics.hunkBg).toBe('rgba(56, 139, 253, 0.15)'); // accent.subtle
    }

    await expect(page).toHaveScreenshot('05-commit-diff.png', {
      animations: 'disabled',
      maxDiffPixels: 0,
      mask: dynamicMasks(page),
    });
    await assertNoCriticalAxeViolations(page);
    const isDark = testInfo.project.name.includes('dark');
    await verifyKeyboardFocusTraversal(
      page,
      isDark ? 'rgb(47, 129, 247)' : 'rgb(9, 105, 218)',
      12
    );
  });

  test('06 - Empty Repository State (空仓库空状态)', async ({ page }) => {
    await page.goto('/acme/empty-repo', { waitUntil: 'networkidle' });
    await stabilizePage(page, '.setup-steps');

    await expect(page).toHaveScreenshot('06-empty-repo.png', {
      animations: 'disabled',
      maxDiffPixels: 0,
      mask: dynamicMasks(page),
    });
    await assertNoCriticalAxeViolations(page);
  });
});
