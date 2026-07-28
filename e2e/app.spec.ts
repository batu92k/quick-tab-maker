import { expect, test, type Page } from '@playwright/test';

// Each test opens the app fresh. IndexedDB is empty in a new context, so the
// app seeds and opens its demo song; waiting for the toolbar's Add bar button
// is the "editor is ready" signal.
async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add bar', exact: true })).toBeVisible();
}

test('loads the editor with a song and a clean history', async ({ page }) => {
  await openEditor(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo Riff');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  // Nothing has been edited yet, so undo is unavailable.
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('an edit enables undo, and undo reverts it', async ({ page }) => {
  await openEditor(page);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });

  await page.getByRole('button', { name: 'Add bar', exact: true }).click();
  await expect(undo).toBeEnabled();

  await undo.click();
  await expect(undo).toBeDisabled();
});

test('places a note on the score by clicking and typing', async ({ page }) => {
  await openEditor(page);
  // Start from a blank song so any note-heads are ones this test placed.
  await page.getByRole('button', { name: /Songs/ }).click();
  await page.getByRole('button', { name: /New song/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Untitled Song');
  await expect(page.locator('.qtm-note')).toHaveCount(0);

  // A new song starts with no instruments; add a guitar so there is a staff to
  // click into.
  await page.getByRole('combobox', { name: 'Add instrument' }).selectOption('guitar');

  // Click a guitar staff, then type a fret. The staff is an SVG group, so click
  // an absolute point inside its box with the mouse rather than the element
  // (the SVG root, not the group, receives pointer events). Any string/beat
  // under the click is a valid target.
  const box = await page.locator('.qtm-staff--guitar').first().boundingBox();
  if (!box) throw new Error('guitar staff not found');
  await page.mouse.click(box.x + 130, box.y + box.height * 0.6);
  await page.keyboard.press('5');

  await expect(page.locator('.qtm-note')).not.toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
});

test('creates, renames, reopens after reload, and deletes a song', async ({ page }) => {
  await openEditor(page);
  const title = `E2E ${Date.now()}`;

  // Create a new song and rename it from the library.
  await page.getByRole('button', { name: /Songs/ }).click();
  await page.getByRole('button', { name: /New song/ }).click();
  await page.getByRole('button', { name: /Songs/ }).click();

  const current = page.locator('.qtm-song-card--current');
  await current.getByRole('button', { name: 'Rename' }).click();
  await current.getByLabel('Song title').fill(title);
  await current.getByRole('button', { name: 'Save' }).click();
  await expect(current.getByText(title)).toBeVisible();

  // The rename reaches the editor, and survives a reload (autosave + reopen the
  // most recent on launch).
  await page.getByRole('button', { name: /Back to editor/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);

  // Delete it from the library; it disappears from the list.
  await page.getByRole('button', { name: /Songs/ }).click();
  const card = page.locator('.qtm-song-card', { hasText: title });
  await card.getByRole('button', { name: 'Delete' }).click();
  await card.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.qtm-song-card', { hasText: title })).toHaveCount(0);
});

test('exports a PDF file', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Export PDF' }).click();

  const dialog = page.getByRole('dialog', { name: 'Export PDF' });
  await expect(dialog).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
});

test('play and stop leave the app responsive', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await openEditor(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();

  // The transport may fall back to silence in headless, but must not crash.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});
