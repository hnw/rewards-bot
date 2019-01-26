const prog_id = 'gendama';
const site_name = 'げん玉';
const rate = 0.1;
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
    await bingo(page);
    await forest(page);
    await race(page);
    const currPoint = await getCurrentPoint(page);
    const earnedPoint = calcEarnedPoint(prevPoint, currPoint);
    if (earnedPoint !== 0.0) {
      const earnedYen = calcEarnedYen(earnedPoint, rate);
      logger.info(`${earnedPoint}pt（${earnedYen}円）を獲得しました`);
    }

    // ログインページ
    async function login(page) {
      logger.debug('login()');
      await page.goto('http://www.realworld.jp/connect_epark?goto=http%3A%2F%2Fwww.gendama.jp%2Fwelcome');
      await epark_login(page);
    }
    async function epark_login(page) {
      logger.debug('epark_login()');

      const id = process.env.EPARK_ID;
      const password = process.env.EPARK_PASSWORD;

      await page.waitForSelector('input[name="auth_login[username]"]', {visible: true})
        .then(el => el.type(id));
      await page.waitForSelector('input[name="auth_login[password]"]', {visible: true})
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
      await page.goto('http://u.realworld.jp/passbook/search/gendama/');
      // ポイントが書いてある要素を取り出す（ゴミ付き…）
      let nPointText = await page.$eval('dl.now dd', el => el.textContent);
      if (!/^\s*[\d,]+R/.test(nPointText)) {
        // 例外を投げるべきかもしれない…
        return -1;
      }
      nPointText = nPointText.replace(/R.*$/, '').replace(/[,\s]/g, '');
      const nPoint = parseInt(nPointText, 10);
      return nPoint;
    }

    // bingo（12時更新）
    async function bingo(page) {
      logger.debug('bingo()');
      await page.goto('http://www.gendama.jp/bingo/');
      // 「ビンゴゲームに参加する」
      try {
        await Promise.all([
          page.waitForNavigation({waitUntil: "domcontentloaded"}),
          page.waitForSelector('#bingoContents a img[src*="start_bt.gif"]', {visible: true, timeout: 10000})
            .then(el => el.click())
        ]);
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // タイムアウトの場合は次の処理へ進む
        logger.debug(e.message);
      }
      // ヒットマスのimg要素だけidがついてる
      const hitCells = await page.$$('table img[id*="NO_"]');
      for (let cell of hitCells) {
        await cell.click();
        await page.waitFor(1000); // 1秒待ち
      }
    }

    // ポイントの森（4時・16時更新）
    async function forest(page) {
      logger.debug('forest()');
      await page.goto('http://www.gendama.jp/forest/');
      // 5pt
      try {
        await page.waitForSelector('img[src*="star.gif"]', {visible: true, timeout: 10000})
          .then(img => img.click());
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // タイムアウトの場合は次の処理へ進む
        logger.debug(e.message);
      }
      // 「毎日必ず1pt」
      try {
        await page.waitFor(1000); // 1秒待ち
        let newPage;
        [newPage] = await Promise.all([
          // 新ウインドウ遷移（target=_blank）待ち
          new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
          page.waitForSelector('img[src*="bt_day1.gif"]', {visible: true, timeout: 10000})
            .then(img => img.click())
        ]);
        await newPage.waitFor(15000); // 15秒待ち
        await newPage.close();
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // タイムアウトの場合は次の処理へ進む
        logger.debug(e.message);
      }

      // 「詳しく見て1pt」
      try {
        // モリモリのおすすめサービス
        const morimoriOsusume = 'div#osusumemori img[src*="forest_bt1.gif"]';
        // モリ子のお気に入りサービス
        const moriko = 'div#moriko img[src*="click_pt.png"]';
        // ページ下部のオススメサービス
        const footerOsusume = 'section#reach img[src*="btn_detail.png"]';

        const imgs = await page.$$([morimoriOsusume,moriko,footerOsusume].join(', '));
        for (let img of imgs) {
          await page.waitFor(1000); // 1秒待ち
          let newPage;
          [newPage] = await Promise.all([
            // 新ウインドウ遷移（target=_blank）待ち
            new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
            img.click()
          ]);
          await newPage.waitFor(15000); // 15秒待ち
          await newPage.close(); // ウインドウを消す
        }
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // タイムアウトの場合は次の処理へ進む
        logger.debug(e.message);
      }
      await page.waitFor(5000); // 5秒待ち
    }

    // モリモリ選手権（0時更新）
    async function race(page) {
      logger.debug('race()');
      await page.goto('http://www.gendama.jp/race/');
      // 前日分の結果をみる（もしあれば）
      try {
        await page.waitForSelector('img[src*="result_btn2.png"]', {visible: true, timeout: 10000})
          .then(img => img.click());
        await page.waitForSelector('img[src*="entry_btn.png"]', {visible: true})
          .then(img => img.click());
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // タイムアウトの場合は次の処理へ進む
        logger.debug(e.message);
      }

      // 当日分参加
      try {
        await page.waitForSelector('img[src*="start_btn.png"]', {visible: true, timeout: 10000})
          .then(img => img.click());
        await page.waitForSelector('img[src*="result_btn.gif"]', {visible: true})
          .then(img => img.click());
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // タイムアウトの場合は次の処理へ進む
        logger.debug(e.message);
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
