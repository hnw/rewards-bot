const prog_id = 'd-money'
const rate = 1;
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
    const prevPoint = await getCurrentPoint(page);
    await scratch(page);
    const currPoint = await getCurrentPoint(page);
    const earnedPoint = calcEarnedPoint(prevPoint, currPoint);
    if (earnedPoint !== 0.0) {
      const earnedYen = calcEarnedYen(earnedPoint, rate);
      logger.info(`${earnedPoint}pt（${earnedYen}円）を獲得しました`);
    }

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

    // 現在ポイントを取得
    async function getCurrentPoint(page) {
      logger.debug('getCurrentPoint()');
      await page.goto('http://d-moneymall.jp/', {waitUntil: "domcontentloaded"});

      let nPointText = await page.$eval('div.p-dmoney-header-small__amount span.p-dmoney-header-small__amount__balance', el => el.textContent);
      nPointText = nPointText.replace(/[,\s]/g, '');
      const nPoint = parseInt(nPointText, 10);
      return nPoint;
    }

    // スクラッチで必ず１マネー
    async function scratch(page) {
      await Promise.all([
        page.waitForNavigation({waitUntil: "domcontentloaded"}),
        page.waitForSelector('a[href*="/scratch"]', {visible: true}).then(el => el.click()),
      ]);
      try {
        await page.waitForSelector('body.body-ScratchPlay', {visible: true, timeout: 10000})
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // 今日はすでに実行済み
        logger.debug(e.message);
        return;
      }

      // 特定の位置をクリック
      await page.waitFor(3000) // 3秒待ち
      await page.mouse.click(650, 395);
      await page.waitFor(3000) // 3秒待ち
      await page.mouse.click(500, 395);
      await page.waitFor(3000) // 3秒待ち
      await page.mouse.click(400, 295);
      await page.waitFor(3000) // 3秒待ち
      await page.mouse.click(500, 295);
    }
    function calcEarnedPoint(prevPoint, currPoint) {
      // 小数第2位まで有効の前提
      // 返り値は浮動小数点数
      return +((currPoint - prevPoint).toFixed(2));
    }
    function calcEarnedYen(earnedPoint, rate) {
      // 小数第2位まで有効の前提
      // 返り値は浮動小数点数
      return +((earnedPoint * rate).toFixed(2));
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
