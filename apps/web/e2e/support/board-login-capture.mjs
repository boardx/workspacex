// Read the real upstream response before releasing it to the login page, which
// immediately performs a full navigation. Do not retain credentials in diagnostics.
export async function captureBoardLogin(page, login) {
  const matches = url => url.pathname.endsWith('/auth/login');
  let capture, posts = 0;
  const errors = [], active = new Set();
  const handle = async route => {
    try {
      if (route.request().method() !== 'POST') return await route.continue();
      posts++;
      const response = await route.fetch({timeout: 15000, maxRedirects: 0});
      let body, jsonParsed = false;
      try { body = await response.json(); jsonParsed = true; } catch { /* schema diagnostic below */ }
      capture = {status: response.status(), body, jsonParsed};
      // Preserve the upstream status, bytes, headers, and Set-Cookie behavior.
      await route.fulfill({response});
    } catch (error) {
      errors.push(error);
      try { await route.abort(); } catch (error) { errors.push(error); }
    }
  };
  const handler = route => {
    const task = handle(route);active.add(task);
    task.then(() => active.delete(task), error => {errors.push(error);active.delete(task);});
    return task;
  };
  let token;
  await page.route(matches, handler);
  try { token = await login(); } catch (error) { errors.push(error); }
  finally {
    try { await page.unroute(matches, handler); } catch (error) { errors.push(error); }
    await Promise.allSettled(active);
  }
  if (errors.length) throw new AggregateError(errors, 'BOARD_LOGIN_CAPTURE_FAILED');
  if (posts !== 1 || !capture) throw new Error('BOARD_LOGIN_SINGLE_POST_REQUIRED');
  return {...capture, token, posts};
}
