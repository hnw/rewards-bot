const prog_id = 'osaifu';
const site_name = 'お財布.com';
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
    await stamp(page);
    await click(page);
    const currPoint = await getCurrentPoint(page);
    const earnedPoint = calcEarnedPoint(prevPoint, currPoint);
    if (earnedPoint !== 0.0) {
      const earnedYen = calcEarnedYen(earnedPoint, rate);
      logger.info(`${earnedPoint}pt（${earnedYen}円）を獲得しました`);
    }

    // ログインページ
    async function login(page) {
      logger.debug('login()');
      await page.goto('https://osaifu.com/login/');

      const id = process.env.OSAIFU_ID;
      const password = process.env.OSAIFU_PASSWORD;

      await page.waitForSelector('input[name="_username"]', {visible: true})
        .then(el => el.type(id));
      await page.waitForSelector('input[name="_password"]', {visible: true})
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
      await page.goto('https://osaifu.com/my-osaifu/');
      // ポイントが書いてある要素を取り出す
      const nCoinText = await page.$eval('div.osaifu__data dl:nth-child(1) dd em', el => el.textContent.replace(/[,\s]/g, ''));
      const nGoldText = await page.$eval('div.osaifu__data dl:nth-child(3) dd em', el => el.textContent.replace(/[,\s]/g, ''));
      const nCoin = parseInt(nCoinText, 10);
      const nGold = parseInt(nGoldText, 10);
      return (nCoin * 10 + nGold) / 10;
    }

    // スタンプラリー
    async function stamp(page) {
      logger.debug('stamp()');
      await page.goto('http://osaifu.com/stamprally/');
      try {
        // スタンプ
        await page.waitForSelector('ul.stamp-pc a', {visible: true, timeout: 10000})
          .then(el => el.click());
        // 「コインGET!!」
        await page.waitForSelector('a.a-btn-cvn', {visible: true});
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // 今日は獲得済み?
        logger.debug(e.message);
      }
    }

    // クリックで貯める
    async function click(page) {
      logger.debug('click()');
      await page.goto('http://osaifu.com/');

      // オーバーレイ広告がもし出ていればclose
      try {
        const closeButton = await page.waitForSelector('div.btn__close a', {visible: true, timeout: 10000});
        await closeButton.click();
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // タイムアウトの場合は要素が見つからなかった
        logger.debug(e.message);
      }
      const anchors = await page.$$('section[data-block-title="クリックで貯める"] li a');
      for (let a of anchors) {
        logger.debug('click() 1');
        // リンクを別ウインドウで開くようにする
        page.evaluate(a => a.setAttribute('target', '_blank') ,a);
        let newPage1;
        [newPage1] = await Promise.all([
          // 新ウインドウ1への遷移（target=_blank）待ち
          new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
          a.click()
        ]);
        // 広告主ページを開く
        logger.debug('click() 2');
        try {
          let newPage2;
          [newPage2] = await Promise.all([
            // 新ウインドウ2への遷移（target=_blank）待ち
            new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
            newPage1.waitForSelector('a.a-btn-cvn', {visible: true})
              .then(el => el.click())
          ]);
          await newPage2.waitFor(2000); // 2秒待ち
          // 新ウインドウ2を消す
          await newPage2.close();
        } catch (e) {
          if (!(e instanceof TimeoutError)) { throw e; }
          // タイムアウトの場合は新ウインドウ2が開いていないのでそのまま戻る
          logger.debug(e.message);
        }
        // 新ウインドウ1を消す
        await newPage1.close();
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
