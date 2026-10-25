'use strict';
/* Starts the app: show a loading state, then sign-in or the user's habits. */

async function bootLoad() {
  ui.boot = 'loading';
  ui.bootErr = '';
  render();
  try {
    const me = await Api.me();
    if (me.authenticated) {
      await enterApp();
    } else {
      ui.boot = 'auth';
      render();
    }
  } catch (e) {
    ui.boot = 'error';
    ui.bootErr = e.offline ? 'Check your connection and try again.' : e.message;
    render();
  }
}

coachInit();
theme();
render();
bootLoad();
