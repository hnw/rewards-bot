const prog_id = 'qoo10'
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
    await qchance(page);
    const currPoint = await getCurrentPoint(page);
    const earnedPoint = calcEarnedPoint(prevPoint, currPoint);
    if (earnedPoint !== 0.0) {
      const earnedYen = calcEarnedYen(earnedPoint, rate);
      logger.info(`${earnedPoint}pt（${earnedYen}円）を獲得しました`);
    }

    // ログインページ
    async function login(page) {
      logger.debug('login()');
      await page.goto('https://www.qoo10.jp/gmkt.inc/Login/Login.aspx');

      const id = process.env.QOO10_ID;
      const password = process.env.QOO10_PASSWORD;

      await page.waitForSelector('form');
      await page.type('input[name="login_id"]', id);
      await page.type('input[name="passwd"]', password);
      await Promise.all([
        page.waitForNavigation({waitUntil: "domcontentloaded"}),
        page.click('form a.btn')
      ]);
    }

    // 現在ポイントを取得
    async function getCurrentPoint(page) {
      logger.debug('getCurrentPoint()');
      await page.goto('https://www.qoo10.jp/gmkt.inc/Event/qchance.aspx', {waitUntil: "domcontentloaded"});

      let nQpointText = await page.$eval('div.info_my tr#tr_loyalty_summary td:nth-child(3)', el => el.textContent);
      nQpointText = nQpointText.replace(/[,\s]*/g, '');
      const nQpoint = parseInt(nQpointText, 10);

      let nMameqText = await page.$eval('div.info_my tr#tr_loyalty_summary td span.grn', el => el.textContent);
      nMameqText = nMameqText.replace(/^[A-Za-z\s]*/g, '');
      const nMameq = parseInt(nMameqText, 10);

      return nQpoint+nMameq;
    }

    async function qchance(page) {
      logger.debug('qchance()');
      await page.goto('https://www.qoo10.jp/gmkt.inc/Event/qchance.aspx');
      await page.waitForSelector('iframe[src*="/Roulette/"]', {visible:true});
      const frame = await waitForFrame(page, f => /\/RouletteQ\.aspx/.test(f.url()));

      // 応募券クリック
      try {
        await frame.waitForSelector('div.card_table a',
                                   {visible: true, timeout: 10000})
          .then(el => el.click());
        await frame.waitFor(5000); // 5秒待ち
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        logger.debug('TimeoutError');
        // 押せなかった（既に押している？）
      }
      // ルーレット
      const rFrame = await waitForFrame(page, f => /\/Roulette\.aspx/.test(f.url()));
      try {
        await rFrame.waitForSelector('img#btn_start',
                                     {visible: true, timeout: 10000})
          .then(el => el.click());
        await frame.waitFor(5000); // 5秒待ち
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        logger.debug('TimeoutError');
        // 押せなかった（既に押している？）
      }
    }
    function waitForFrame(page, func) {
      let fulfill;
      const promise = new Promise(x => fulfill = x);
      checkFrame();
      return promise;

      function checkFrame() {
        const frame = page.frames().find(func);
        if (frame) {
          fulfill(frame);
        } else {
          page.once('framenavigated', checkFrame);
        }
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
