const prog_id = 'rakuten-card'
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
    let nClicked = 0;
    while (true) {
      let i = await clickUncheckedAd(page);
      if (i == 0) {
        break;
      }
      nClicked += i;
    }
    if (nClicked > 0) {
      logger.info(nClicked + ' ads clicked.');
    }

    // ログインページ
    async function login(page) {
      logger.debug('login()');
      await page.goto('https://www.rakuten-card.co.jp/e-navi/members/point/click-point/index.xhtml');

      const id = process.env.RAKUTEN_ID;
      const password = process.env.RAKUTEN_PASSWORD;

      await page.waitForSelector('input[name="u"]', {visible: true})
        .then(el => el.type(id));
      await page.type('input[name="p"]', password);
      await Promise.all([
        page.waitForNavigation({waitUntil: "domcontentloaded"}),
        page.click('input[type="submit"]')
      ]);
    }

    async function clickUncheckedAd(page) {
      const ads = await page.$$('div.topArea');
      for (let ad of ads) {
        if (await ad.$('div.dateBox img') != null) {
          const banner = await ad.$('div.bnrBox img');
          let newPage;
          [newPage] = await Promise.all([
            new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
            banner.click()
          ]);
          await newPage.waitFor(2000); // 2秒待ち（遷移待ち）
          await newPage.close(); // 新ウインドウを消す
          return 1;
        }
      }
      return 0;
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
