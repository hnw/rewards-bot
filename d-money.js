const prog_id = 'd-money'
require('dotenv').config();
const yargs = require('yargs')
      .usage('Usage: $0 [options]')
      .boolean('debug')
      .describe('debug', 'Force headful')
      .help()
      .version('0.0.1')
      .locale('en');
const argv = yargs.argv;

let log4js_appenders;
if (argv.debug) {
  log4js_appenders = ['console_raw', 'result', 'debug'];
} else {
  log4js_appenders = ['console', 'result'];
}

const log4js = require('log4js');
log4js.configure({
  appenders: {
    debug: { type: 'dateFile', filename: 'log/debug', alwaysIncludePattern: true},
    result_raw: { type: 'dateFile', filename: 'log/result', alwaysIncludePattern: true, layout: { type: 'pattern', pattern: '[%d] [%p] %m' } },
    console_raw: { type: 'console', layout: { type: 'messagePassThrough' } },
    console: { type: 'logLevelFilter', appender: 'console_raw', level: 'info' },
    result: { type: 'logLevelFilter', appender: 'result_raw', level: 'info' },
  },
  categories: { default: { appenders: log4js_appenders, level: 'debug' } }
});
const logger = log4js.getLogger(prog_id);

const puppeteer = require('puppeteer');
const {TimeoutError} = require('puppeteer/Errors');
const path = require('path');
const scriptName = path.basename(__filename);
const options = {
  "headless" : !(argv.debug),
  "slowMo" : 'SLOWMO' in process.env ? parseInt(process.env.SLOWMO, 10) : 200,
  "defaultViewport" : {
    "width": 'VIEWPORT_WIDTH' in process.env ? parseInt(process.env.VIEWPORT_WIDTH, 10) : 1024,
    "height": 'VIEWPORT_HEIGHT' in process.env ? parseInt(process.env.VIEWPORT_HEIGHT, 10) : 768
  },
};

(async () => {
  const browser = await puppeteer.launch(options);
  let page = await browser.newPage();
  if (argv.debug) {
    page.on('console', msg => logger.debug('PAGE LOG:', msg.text()));
  }

  try {
    await login(page);
    await scratch(page);

    // ログインページ
    async function login(page) {
      logger.debug('login()');
      await page.goto('http://d-moneymall.jp/');

      const id = process.env.AMEBA_ID;
      const password = process.env.AMEBA_PASSWORD;

      page.waitForSelector('a[href*="https://aw.mobadme.jp"]', {visible: true}).then(el => el.click());
      page.waitForSelector('form[action*="https://dauth.user.ameba.jp/login/"] input[type="submit"]', {visible: true}).then(el => el.click());
      await page.waitForSelector('form[action*="https://dauth.user.ameba.jp/accounts/login"');
      await page.type('input[name="accountId"]', id);
      await page.type('input[name="password"]', password);
      await Promise.all([
        page.waitForNavigation({waitUntil: "domcontentloaded"}),
        page.click('input[type="submit"]')
      ]);
    }

    async function scratch(page) {
      await Promise.all([
        page.waitForNavigation({waitUntil: "domcontentloaded"}),
        page.waitForSelector('a[href*="/scratch"]', {visible: true}).then(el => el.click()),
      ]);
      await page.waitForSelector('body.body-ScratchPlay', {visible: true, timeout: 10000})
      // 特定の位置をクリック
      await page.waitFor(3000) // 3秒待ち
      await page.mouse.click(650, 395);
      logger.debug('650-395');
      await page.waitFor(3000) // 3秒待ち
      await page.mouse.click(500, 395);
      logger.debug('500-395');
      await page.waitFor(3000) // 3秒待ち
      await page.mouse.click(400, 295);
      logger.debug('400-295');
      await page.waitFor(3000) // 3秒待ち
      await page.mouse.click(500, 295);
      logger.debug('500-295');
      
    }
  } catch (e) {
    logger.error(e);
  } finally {
    logger.debug('The script is finished.');
    if (!argv.debug) {
      await browser.close();
    }
  }
})();
