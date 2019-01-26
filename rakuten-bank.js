const prog_id = 'rakuten-bank'
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
    await genkinpresent(page);

    // ログインページ
    async function login(page) {
      logger.debug('login()');
      await page.goto('https://fes.rakuten-bank.co.jp/MS/main/RbS?CurrentPageID=START&&COMMAND=LOGIN');

      const id = process.env.RAKUTENBANK_ID;
      const password = process.env.RAKUTENBANK_PASSWORD;

      await page.waitForSelector('form#LOGIN');
      await page.type('input[name="LOGIN:USER_ID"]', id);
      await page.type('input[name="LOGIN:LOGIN_PASSWORD"]', password);
      await Promise.all([
        page.waitForNavigation({waitUntil: "domcontentloaded"}),
        page.click('form#LOGIN div.btn-login01 a')
      ]);
    }
    async function genkinpresent(page) {
      logger.debug('genkinpresent()');
      await Promise.all([
        page.waitForNavigation({waitUntil: "domcontentloaded"}),
        page.waitForSelector('a[onclick*="genkinpresent"]', {visible: true}).then(el=> el.click())
      ]);

      try {
        await page.waitFor(5000); // 5秒待ち
        // 1回起動につき最大10クリック
        for (let i = 0; i < 10; i++) {
          const btn = await page.waitForSelector('input[src*="btn-check-on"]', {visible: true, timeout: 10000});
          let newPage;
          [newPage] = await Promise.all([
            // 新ウインドウ遷移（target=_blank）待ち
            new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
            btn.click()
          ]);
          await newPage.waitFor(15000); // 15秒待ち（遷移待ち）
          await newPage.close(); // 新ウインドウを消す
        }
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        logger.debug('TimeoutError');
        // 押すものがなくなった
      }
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
