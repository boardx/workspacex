# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: board-spatial-relationships.spec.ts >> multi-select transform, Panel clip/expand, connector preservation, and total z-order survive reload
- Location: e2e/board-spatial-relationships.spec.ts:91:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/^已同步$/)
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText(/^已同步$/)

```

```yaml
- alert
- link "跳到主要内容":
  - /url: "#wsx-main-content"
- main:
  - text: 未确认修改会加密保存在此浏览器，并在刷新、关闭或重连后按原操作 ID 重放。在线成员 2
  - region "白板对象大纲":
    - heading "白板对象" [level=2]
    - paragraph: 使用 Tab 浏览对象，Enter 选择。
    - list "白板对象":
      - listitem:
        - button "图形：便利贴": 便利贴
      - listitem:
        - button "图形：连接线": 连接线
      - listitem:
        - button "图形：新区域": 新区域
    - paragraph: 未选择对象
  - button "返回白板"
  - textbox "白板名称" [disabled]: Spatial ec17f5c2-6f37-4f86-b99c-89c3ec0a4879
  - status: 8 项修改等待服务器确认
  - button "撤销"
  - button "重做"
  - button "复制" [disabled]
  - button "粘贴" [disabled]
  - button "删除选中" [disabled]
  - button "缩小"
  - text: 100%
  - button "放大"
  - button "适应选择" [disabled]
  - button "适应白板"
  - button "演示视图"
  - button "跟随Fullstack E2E admin（成员）": F
  - button "跟随Fullstack E2E admin（成员）": F
  - button "Choose File"
  - navigation "白板工具":
    - button "选择，快捷键 V" [pressed]:
      - img
      - text: 选择
    - button "移动画布，快捷键 H":
      - img
      - text: 移动画布
    - button "便利贴，快捷键 N":
      - img
      - text: 便利贴
    - button "文字，快捷键 T":
      - img
      - text: 文字
    - button "形状，快捷键 S":
      - img
      - text: 形状
    - button "绘制，快捷键 P":
      - img
      - text: 绘制
    - button "连接，快捷键 C":
      - img
      - text: 连接
    - button "图片，快捷键 I":
      - img
      - text: 图片
    - button "更多":
      - img
      - img
      - text: 更多
    - button "区域，快捷键 F":
      - img
      - text: 区域
  - status: 0 个已选对象
```

# Test source

```ts
  105 |   await page.getByTestId("board-tool-select").click();
  106 | 
  107 |   // Real marquee exercises Fabric ActiveSelection; matrix scale/rotation stays covered by
  108 |   // the renderer's deterministic Fabric tests until Iteration 06 normalizes its origin.
  109 |   const canvas = page.getByTestId("board-fabric-canvas"); const box = (await canvas.boundingBox())!;
  110 |   await page.mouse.move(box.x + 20, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x + 1250, box.y + 760, { steps: 12 }); await page.mouse.up();
  111 |   await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("已选择 3 个对象");
  112 | 
  113 |   const panel = objectRow(page, "panel");
  114 |   const stickyRows = page.locator('[data-testid="board-a11y-mirror"] li[data-object-kind="sticky"]');
  115 |   const stickyGeometries = await stickyRows.evaluateAll(rows => rows.map(row => JSON.parse((row as HTMLElement).dataset.geometry!) as Geometry));
  116 |   const insideIndex = stickyGeometries.findIndex(value => value.x < 700);
  117 |   const firstId = (await stickyRows.nth(insideIndex).getAttribute("data-object-id"))!;
  118 |   const secondId = (await stickyRows.nth(insideIndex === 0 ? 1 : 0).getAttribute("data-object-id"))!;
  119 |   // Bind by immutable object identity: positional locators retarget after deletion.
  120 |   const firstSticky = page.locator(`[data-testid="board-a11y-mirror"] li[data-object-id="${firstId}"]`);
  121 |   const secondSticky = page.locator(`[data-testid="board-a11y-mirror"] li[data-object-id="${secondId}"]`);
  122 |   const panelId = (await panel.getAttribute("data-object-id"))!;
  123 |   // Give the first Sticky a canonical parent through a completed Fabric gesture.
  124 |   await dragObject(page, firstSticky, 12, 8);
  125 |   await expect(firstSticky).toHaveAttribute("data-parent-id", panelId);
  126 | 
  127 |   // Panel policies are mutually exclusive. A rotated/absolute Fabric clipPath is projected for its child and blocks escape atomically.
  128 |   await panel.getByRole("button").focus(); await page.keyboard.press("Enter");
  129 |   await openInspector(page, true);
  130 |   await page.getByLabel("自动扩展").uncheck(); await page.getByLabel("裁剪内容").check();
  131 |   await expect(page.getByLabel("自动扩展")).toBeDisabled();
  132 |   await expect(firstSticky).toHaveAttribute("data-clip-parent-id", panelId);
  133 |   const clippedGeometry = await firstSticky.getAttribute("data-geometry");
  134 |   await dragObject(page, firstSticky, 620, 420, "reject");
  135 |   await expect(firstSticky).toHaveAttribute("data-geometry", clippedGeometry!);
  136 | 
  137 |   // With auto-expand enabled, the same boundary crossing retains parentId and expands the Panel.
  138 |   const panelBeforeExpand = await geometryOf(panel);
  139 |   await panel.getByRole("button").focus(); await page.keyboard.press("Enter");
  140 |   await openInspector(page, true);
  141 |   await page.getByLabel("裁剪内容").uncheck(); await page.getByLabel("自动扩展").check();
  142 |   await dragObject(page, firstSticky, 620, 320);
  143 |   const panelAfterExpand = await geometryOf(panel);
  144 |   expect(panelAfterExpand.width > panelBeforeExpand.width || panelAfterExpand.height > panelBeforeExpand.height).toBe(true);
  145 |   await expect(firstSticky).toHaveAttribute("data-parent-id", panelId);
  146 | 
  147 |   // A locked sibling keeps its exact zIndex while one-step layer movement swaps only one relative position.
  148 |   await panel.getByRole("button").focus(); await page.keyboard.press("Enter");
  149 |   await clickObjectAction(page, "锁定");
  150 |   const lockedPanelZ = Number(await panel.getAttribute("data-z-index"));
  151 |   await secondSticky.getByRole("button").focus(); await page.keyboard.press("Enter");
  152 |   await clickObjectAction(page, "置于底层");
  153 |   await clickObjectAction(page, "上移一层");
  154 |   // A locked anchor can make a one-step command a legitimate no-op at its
  155 |   // boundary; the invariant is that the anchor stays fixed and total order
  156 |   // remains unique through all four commands.
  157 |   expect(Number(await panel.getAttribute("data-z-index"))).toBe(lockedPanelZ);
  158 |   for (const label of ["置于顶层", "下移一层", "置于底层"]) await clickObjectAction(page, label);
  159 |   const zBeforeReload = await page.locator('[data-testid="board-a11y-mirror"] li').evaluateAll(rows => rows.map(row => Number((row as HTMLElement).dataset.zIndex)));
  160 |   expect(new Set(zBeforeReload).size).toBe(zBeforeReload.length);
  161 |   await panel.getByRole("button").focus(); await page.keyboard.press("Enter");
  162 |   await clickObjectAction(page, "解锁");
  163 | 
  164 |   // Explicit endpoint deletion keeps a free endpoint connector; the other attached end remains live.
  165 |   await firstSticky.getByRole("button").focus(); await page.keyboard.press("Enter");
  166 |   await page.getByTestId(`connector-handle-${firstId}-right`).evaluate(element => {
  167 |     const transfer = new DataTransfer(); (window as typeof window & { __boardConnectorTransfer?: DataTransfer }).__boardConnectorTransfer = transfer;
  168 |     element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
  169 |   });
  170 |   await secondSticky.getByRole("button").focus(); await page.keyboard.press("Enter");
  171 |   await page.getByTestId(`connector-handle-${secondId}-left`).evaluate(element => {
  172 |     const transfer = (window as typeof window & { __boardConnectorTransfer?: DataTransfer }).__boardConnectorTransfer!;
  173 |     element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
  174 |   });
  175 |   const connector = objectRow(page, "connector");
  176 |   const connectorStart = JSON.parse((await connector.getAttribute("data-connector-start"))!) as { x: number; y: number };
  177 |   const connectorEnd = JSON.parse((await connector.getAttribute("data-connector-end"))!) as { x: number; y: number };
  178 |   const expectedStart = anchorPoint(await geometryOf(firstSticky), "right"), expectedEnd = anchorPoint(await geometryOf(secondSticky), "left");
  179 |   expect(connectorStart.x).toBeCloseTo(expectedStart.x, 5); expect(connectorStart.y).toBeCloseTo(expectedStart.y, 5);
  180 |   expect(connectorEnd.x).toBeCloseTo(expectedEnd.x, 5); expect(connectorEnd.y).toBeCloseTo(expectedEnd.y, 5);
  181 |   const connectorStartBeforeMove = await connector.getAttribute("data-connector-start");
  182 |   // Auto-expand moved the child beyond the initial viewport; fit the complete
  183 |   // board before a real pointer gesture so the browser can hit its interior.
  184 |   const beforeFit = await canvasTransform(page);
  185 |   await page.getByTestId("board-zoom-fit-board").click();
  186 |   await expect.poll(() => canvasTransform(page)).not.toEqual(beforeFit);
  187 |   await dragObject(page, firstSticky, 40, 30);
  188 |   await expect(connector).not.toHaveAttribute("data-connector-start", connectorStartBeforeMove!);
  189 |   // Transparent connector bounds must pass through, but its visible stroke must
  190 |   // still be selectable using a real pointer (not the accessibility outline).
  191 |   const movedStart = JSON.parse((await connector.getAttribute("data-connector-start"))!) as { x: number; y: number };
  192 |   const movedEnd = JSON.parse((await connector.getAttribute("data-connector-end"))!) as { x: number; y: number };
  193 |   const lineViewport = await canvasTransform(page);
  194 |   await page.mouse.click(lineViewport.box.x + lineViewport.panX + (movedStart.x + movedEnd.x) / 2 * lineViewport.zoom,
  195 |     lineViewport.box.y + lineViewport.panY + (movedStart.y + movedEnd.y) / 2 * lineViewport.zoom);
  196 |   await expect(connector.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  197 |   await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("已选择 1 个对象");
  198 |   await firstSticky.getByRole("button").focus(); await page.keyboard.press("Enter");
  199 |   await openInspector(page);
  200 |   await page.getByTestId("board-delete-preserve-connectors").click();
  201 |   await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(3);
  202 |   await expect(connector).toHaveAttribute("data-connector-from", "");
  203 |   await expect(connector).toHaveAttribute("data-connector-to", secondId);
  204 |   const peer = await page.context().newPage();
> 205 |   await peer.goto(`/studio/board/${boardId}`); await expect(peer.getByText(/^已同步$/)).toBeVisible();
      |                                                                                      ^ Error: expect(locator).toBeVisible() failed
  206 |   await expect.poll(() => boardRows(peer)).toEqual(await boardRows(page));
  207 | 
  208 |   const expectedRows = await boardRows(page);
  209 |   await expect.poll(() => boardRows(peer)).toEqual(expectedRows);
  210 | 
  211 |   await page.reload(); await expect(page.getByText(/^已同步$/)).toBeVisible();
  212 |   await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(3);
  213 |   const reloadedRows = await boardRows(page);
  214 |   expect(reloadedRows).toEqual(expectedRows);
  215 |   await peer.close();
  216 | });
  217 | 
  218 | async function openEmptyBoard(page: Page, request: APIRequestContext, prefix: string) {
  219 |   const token = await login(page);
  220 |   const created = await apiCall(request, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `${prefix} ${randomUUID()}` });
  221 |   const boardId = (await created.json() as { id: string }).id;
  222 |   cleanup = { id: boardId, token };
  223 |   await page.goto(`/studio/board/${boardId}`);
  224 |   await expect(page.getByText(/^已同步$/)).toBeVisible();
  225 |   return boardId;
  226 | }
  227 | 
  228 | test("selection transform locks", async ({ page, request }) => {
  229 |   await openEmptyBoard(page, request, "Selection locks");
  230 |   await page.getByTestId("board-add-sticky").click();
  231 |   await page.getByTestId("board-sticky-square").dragTo(page.getByTestId("board-fabric-surface"), { targetPosition: { x: 950, y: 470 } });
  232 |   await page.getByTestId("board-tool-select").click();
  233 |   const stickies = page.locator('[data-testid="board-a11y-mirror"] li[data-object-kind="sticky"]');
  234 |   await expect(stickies).toHaveCount(2);
  235 |   const locked = stickies.nth(0), free = stickies.nth(1);
  236 |   const lockedBefore = await geometryOf(locked), freeBefore = await geometryOf(free);
  237 |   await locked.getByRole("button").focus();
  238 |   await page.keyboard.press("Enter");
  239 |   await clickObjectAction(page, "锁定");
  240 |   await openInspector(page);
  241 |   await expect(page.getByTestId("board-spatial-duplicate")).toBeDisabled();
  242 |   const canvas = page.getByTestId("board-fabric-canvas"), box = (await canvas.boundingBox())!;
  243 |   await page.mouse.move(box.x + 10, box.y + 70); await page.mouse.down(); await page.mouse.move(box.x + 1180, box.y + 700, { steps: 10 }); await page.mouse.up();
  244 |   await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("已选择 2 个对象");
  245 |   const transform = await canvasTransform(page);
  246 |   const start = { x: transform.box.x + transform.panX + (freeBefore.x + freeBefore.width / 4) * transform.zoom, y: transform.box.y + transform.panY + (freeBefore.y + freeBefore.height / 2) * transform.zoom };
  247 |   await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 90 * transform.zoom, start.y + 60 * transform.zoom, { steps: 10 }); await page.mouse.up();
  248 |   await expect.poll(() => geometryOf(free)).toMatchObject({ x: freeBefore.x + 90, y: freeBefore.y + 60 });
  249 |   expect(await geometryOf(locked)).toEqual(lockedBefore);
  250 |   await page.getByRole("button", { name: "撤销", exact: true }).click();
  251 |   await expect.poll(() => geometryOf(free)).toEqual(freeBefore);
  252 |   expect(await geometryOf(locked)).toEqual(lockedBefore);
  253 |   await locked.getByRole("button").focus(); await page.keyboard.press("Enter");
  254 |   await clickObjectAction(page, "解锁");
  255 | });
  256 | 
  257 | test("copy paste sanitization", async ({ page, request }) => {
  258 |   await openEmptyBoard(page, request, "Clipboard sanitization");
  259 |   await page.getByTestId("board-add-sticky").click();
  260 |   await page.keyboard.press("Escape");
  261 |   const outline = page.getByTestId("board-a11y-mirror").getByRole("button");
  262 |   await expect(outline).toHaveCount(1);
  263 |   const originalId = await objectRow(page, "sticky").getAttribute("data-object-id");
  264 |   const originalGeometry = await geometryOf(objectRow(page, "sticky"));
  265 |   await page.keyboard.press(process.platform === "darwin" ? "Meta+C" : "Control+C");
  266 |   await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  267 |   await expect(outline).toHaveCount(2);
  268 |   const ids = await page.locator('[data-testid="board-a11y-mirror"] li').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.objectId));
  269 |   expect(new Set(ids).size).toBe(2);
  270 |   expect(ids).toContain(originalId);
  271 |   const pasted = await geometryOf(page.locator(`[data-testid="board-a11y-mirror"] li[data-object-id]:not([data-object-id="${originalId}"])`).first());
  272 |   expect(pasted).toMatchObject({ x: originalGeometry.x + 24, y: originalGeometry.y + 24 });
  273 |   await page.keyboard.press(process.platform === "darwin" ? "Meta+D" : "Control+D");
  274 |   await expect(outline).toHaveCount(3);
  275 |   const selectedRow = page.locator('[data-testid="board-a11y-mirror"] li').filter({ has: page.locator('button[aria-pressed="true"]') }).first();
  276 |   const selectedId = (await selectedRow.getAttribute("data-object-id"))!, selectedBefore = await geometryOf(selectedRow);
  277 |   const beforeAltIds = new Set(await page.locator('[data-testid="board-a11y-mirror"] li[data-object-id]').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.objectId!)));
  278 |   const surfaceTransform = await canvasTransform(page);
  279 |   // The three copies overlap by 24 px. Start in the selected copy's exposed
  280 |   // right strip so Fabric cannot retarget the Alt-drag to an older copy below.
  281 |   const dragStart = { x: surfaceTransform.box.x + surfaceTransform.panX + (selectedBefore.x + selectedBefore.width - 12) * surfaceTransform.zoom, y: surfaceTransform.box.y + surfaceTransform.panY + (selectedBefore.y + selectedBefore.height / 2) * surfaceTransform.zoom };
  282 |   await page.keyboard.down("Alt");
  283 |   await page.mouse.move(dragStart.x, dragStart.y); await page.mouse.down(); await page.mouse.move(dragStart.x + 36 * surfaceTransform.zoom, dragStart.y + 28 * surfaceTransform.zoom, { steps: 8 }); await page.mouse.up();
  284 |   await page.keyboard.up("Alt");
  285 |   await expect(outline).toHaveCount(4);
  286 |   expect(await geometryOf(page.locator(`[data-testid="board-a11y-mirror"] li[data-object-id="${selectedId}"]`))).toEqual(selectedBefore);
  287 |   const altCopyId = await page.locator('[data-testid="board-a11y-mirror"] li[data-object-id]').evaluateAll((rows, previousIds) => {
  288 |     const previous = new Set(previousIds as string[]);
  289 |     return rows.map(row => (row as HTMLElement).dataset.objectId!).find(id => !previous.has(id));
  290 |   }, [...beforeAltIds]);
  291 |   expect(altCopyId).toBeTruthy();
  292 |   const altCopy = page.locator(`[data-testid="board-a11y-mirror"] li[data-object-id="${altCopyId}"]`);
  293 |   const altGeometry = await geometryOf(altCopy);
  294 |   expect(altGeometry.x).toBe(selectedBefore.x + 36);
  295 |   expect(altGeometry.y).toBe(selectedBefore.y + 28);
  296 |   expect({ x: altGeometry.x - selectedBefore.x, y: altGeometry.y - selectedBefore.y }).not.toEqual({ x: 24, y: 24 });
  297 | 
  298 |   await page.getByTestId("collaborative-editor").evaluate(element => {
  299 |     const transfer = new DataTransfer();
  300 |     transfer.setData("text/plain", "<img src=x onerror=alert(1)>\n<script>globalThis.__boardPwned=true</script>");
  301 |     element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
  302 |   });
  303 |   await expect(page.getByRole("dialog", { name: "如何放入这些内容？" })).toBeVisible();
  304 |   await page.getByTestId("board-paste-stickies").click();
  305 |   await expect(outline).toHaveCount(6);
```