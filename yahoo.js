const prog_id = 'yahoo';
const site_name = 'Yahoo!';
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
    await everydayLot(page);
    await campaignLot(page);
    const currPoint = await getCurrentPoint(page);
    const earnedPoint = calcEarnedPoint(prevPoint, currPoint);
    if (earnedPoint !== 0.0) {
      const earnedYen = calcEarnedYen(earnedPoint, rate);
      logger.info(`${earnedPoint}pt（${earnedYen}円）を獲得しました`);
    }

    // ログインページ
    async function login(page) {
      logger.debug('login()');
      await page.goto('https://login.yahoo.co.jp/config/login?.src=kuji&card_cushion_skip=1&.done=https://toku.yahoo.co.jp/', {waitUntil: "domcontentloaded"});


      const id = process.env.YAHOO_ID;
      const password = process.env.YAHOO_PASSWORD;

      await page.waitForSelector('input[name="login"]', {visible: true})
        .then(el => el.type(id));
      await page.waitForSelector('button[type="submit"]', {visible: true})
        .then(el => el.click());
      await page.waitForSelector('input[name="passwd"]', {visible: true})
        .then(el => el.type(password));
      await Promise.all([
        page.waitForNavigation({waitUntil: "domcontentloaded"}),
        page.waitForSelector('button[type="submit"]', {visible: true})
          .then(el => el.click())
      ]);
    }

    // 現在ポイントを取得
    async function getCurrentPoint(page) {
      logger.debug('getCurrentPoint()');
      await page.goto('https://points.yahoo.co.jp/book', {waitUntil: "domcontentloaded"});

      let nPointText = await page.$eval('div#ptbook div.Totalbox dd.typeTotal', el => el.textContent);
      nPointText = nPointText.replace(/[,\s]/g, '');
      const nPoint = parseInt(nPointText, 10);

      return nPoint;
    }

    // ズバトク毎日くじ
    async function everydayLot(page) {
      logger.debug('everydayLot()');
      await page.goto('https://toku.yahoo.co.jp/everyday/lot/', {waitUntil: "domcontentloaded"});
      try {
        const button = await page.waitForSelector('button#btnLot', {visible: true, timeout: 10000});
        await Promise.all([
          page.waitForNavigation({waitUntil: "domcontentloaded"}),
          button.click()
        ]);
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // タイムアウトの場合は次の処理へ進む
        logger.debug(e.message);
      }
    }

    // 開催中くじ
    async function campaignLot(page) {
      logger.debug('campaignLot()');
      await page.goto('https://toku.yahoo.co.jp/', {waitUntil: "domcontentloaded"});
      const lotTopUrl = page.url();
      // ページ内の全リンクを別ウインドウで開くようにする
      await page.$$eval('a', list => {
        list.forEach(el => el.setAttribute('target', '_blank'))
      });
      const anchors = await page.$$('div#cmpbnr.isActive li.cmpBox a');
      for (let a of anchors) {
        let newPage;
        [newPage] = await Promise.all([
          // 新ウインドウ遷移（target=_blank）待ち
          new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
          a.click(),
        ]);
        try {
          const button = await newPage.waitForSelector('button#btnLot', {visible: true, timeout: 10000});
          await Promise.all([
            newPage.waitForNavigation({waitUntil: "domcontentloaded"}),
            button.click()
          ]);
        } catch (e) {
          if (!(e instanceof TimeoutError)) { throw e; }
          // タイムアウトの場合は次の処理へ進む
          logger.debug(e.message);
        }
        // 新ウインドウを消す
        await newPage.close();
      }
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
