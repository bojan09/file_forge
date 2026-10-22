import { expect, test } from "@playwright/test";
import { convertAndDownload, fixture, uploadFile, waitForWorkspace } from "./helpers";

// Some browsers, extensions and polyfills make DOM calls such as window.scrollTo() or element.focus() return a value.
// An effect that returns that value makes React call it as a cleanup function ("i is not a function") and the whole app dies.
test.describe("hostile browser environment", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const scrollTo = window.scrollTo.bind(window);
      (window as unknown as { scrollTo: (...a: unknown[]) => unknown }).scrollTo = (...a: unknown[]) => {
        (scrollTo as (...a: unknown[]) => void)(...a);
        return { patched: true };
      };
      const focus = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function (this: HTMLElement, ...a: []) {
        focus.apply(this, a);
        return this as unknown as void;
      };
    });
  });

  test("navigation, conversion, batch and PDF tools keep working when scrollTo() and focus() return values", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.evaluate(() => (document.querySelector('a[href="/formats/"]') as HTMLAnchorElement).click());
    await expect(page.getByRole("heading", { name: "Supported formats" })).toBeVisible();
    await page.evaluate(() => (document.querySelector('a[href="/"]') as HTMLAnchorElement).click());

    await uploadFile(page, fixture("sample.md"));
    await waitForWorkspace(page);
    await convertAndDownload(page);
    await page.getByTestId("convert-another").click();

    await page.getByTestId("file-input").setInputFiles([fixture("sample.txt"), fixture("sample.md")]);
    await expect(page.getByTestId("batch-workspace")).toBeVisible();
    await page.getByTestId("clear-queue").click();
    await page.getByTestId("clear-yes").click();
    await expect(page.getByTestId("file-input")).toBeAttached();

    await page.goto("/pdf-tools/");
    await expect(page.getByTestId("pdf-tools")).toBeVisible();
    await page.getByTestId("tool-organize").click();
    expect(errors).toEqual([]);
  });
});
