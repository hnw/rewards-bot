const prog_id = 'gmo-point'
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
    await item_search(page);
    await kuma_click(page);

    // ログインページ
    async function login(page) {
      logger.debug('login()');
      await page.goto('https://point.gmo.jp/auth/login');

      await page.waitForSelector('form[name="LineLoginForm"]', {visible: true})
        .then(el => el.click());
      // LINEログインページ
      const id = process.env.LINE_ID;
      const password = process.env.LINE_PASSWORD;
      await page.waitForSelector('input[name="tid"]', {visible: true})
        .then(el => el.type(id));
      await page.type('input[name="tpasswd"]', password);
      await Promise.all([
        page.waitForNavigation({waitUntil: "domcontentloaded"}),
        page.click('input[type="submit"]')
      ]);
    }

    // 商品検索で1ポイント
    async function item_search(page) {
      logger.debug('item_search()');
      const candidates = ['飲料', '電池', '洗剤'];
      const searchWord = candidates[Math.floor(Math.random() * candidates.length)];
      await page.goto('https://point.gmo.jp/shopping/top');
      await page.waitForSelector('input[name="search_word"]', {visible: true})
        .then(el => el.type(searchWord));
      await Promise.all([
        page.waitForNavigation({waitUntil: "domcontentloaded"}),
        page.click('a.Btn_search')
      ]);
    }

    // クリックするだけで毎日1ポイント
    async function kuma_click(page) {
      logger.debug('kuma_click()');

      await page.goto('https://point.gmo.jp/service/top');

      try {
        await page.waitForSelector('img[src*="btn-modal"]',
                                   {visible: true, timeout: 10000})
          .then(el => el.click());
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // モーダルダイアログが出ていなかった、次に進む
        logger.info(e.message);
      }
      await page.waitFor(5000); // 5秒待ち（遷移待ち）
      logger.debug('kuma_click() 2');

      let newPage
      [newPage] = await Promise.all([
        new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
        page.waitForSelector('img[src*="kuma_click"]', {visible: true})
          .then(el => el.click())
      ]);
      await newPage.waitFor(5000); // 5秒待ち（遷移待ち）        
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
