const prog_id = 'moppy'
const site_name = 'モッピー';
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
    await bingo(page);
    await gacha(page);
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
      await page.goto('https://ssl.pc.moppy.jp/login/')

      const id = process.env.MOPPY_ID;
      const password = process.env.MOPPY_PASSWORD;

      await page.waitForSelector('input[name="mail"]', {visible: true})
        .then(el => el.type(id));
      await page.waitForSelector('input[name="pass"]', {visible: true})
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
      await page.goto('http://pc.moppy.jp/bankbook/');
      // ポイントが書いてある要素を取り出す
      const div = await page.$('div.point div.data');
      const nPointText = await div.$eval('strong', el => el.textContent.replace(/[,\s]/g, ''));
      const nCoinText = await div.$eval('em', el => el.textContent.replace(/[,\s]/g, ''));
      const nPoint = parseInt(nPointText, 10);
      const nCoin = parseInt(nCoinText, 10);
      return (nPoint * 10 + nCoin) / 10;
    }

    // ガチャ（2時更新）
    async function gacha(page) {
      logger.debug('gacha()');
      await page.goto('http://pc.moppy.jp/pc_gacha/');
      try {
        // 「いますぐ遊ぶ」ボタン
        await page.waitForSelector('img[src*="startbtn.png"]', {visible: true, timeout: 10000})
          .then(img => img.click());
        // ガチャのハンドル
        await page.waitForSelector('img[src*="bar1.png"]', {visible: true})
          .then(img => img.click());
        // 「結果を見る」ボタン
        await page.waitForSelector('img[src*="endbtn.png"]', {visible: true})
          .then(img => img.click())
        // オーバーレイ広告がもし出ていればclose
        try {
          const closeButton = await page.waitForSelector('div.delete a', {visible: true, timeout: 10000});
          await closeButton.click();
        } catch (e) {
          if (!(e instanceof TimeoutError)) { throw e; }
          // タイムアウトの場合は要素が見つからなかった
          logger.debug(e.message);
        }
        // 「今日のおすすめ広告」
        const saveButton = await page.waitForSelector('img[src*="gacha/468x60.jpg"]', {visible: true});
        await Promise.all([
          page.waitForNavigation({waitUntil: "domcontentloaded"}),
          saveButton.click()
        ]);
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // タイムアウトの場合は次の処理へ進む
        logger.debug(e.message);
      }
      await page.waitFor(10000); // 10秒待ち
    }

    // カジノビンゴ（0時・12時更新）
    async function bingo(page) {
      logger.debug('bingo()');
      await page.goto('http://pc.moppy.jp/gamecontents/bingo_pc/');

      try {
        await page.waitForSelector('img[src*="btn_roulette.png"]', {visible: true, timeout: 10000})
          .then(img => img.click());
        // 「結果を見る」
        await page.waitForSelector('img[src*="btn_play_finish.png"]', {visible: true})
          .then(img => img.click());
        // オーバーレイ広告がもし出ていればclose
        try {
          await page.waitForSelector('div.delete span.icon-cross', {visible: true, timeout: 20000})
            .then(el => el.click());
        } catch (e) {
          if (!(e instanceof TimeoutError)) { throw e; }
          // タイムアウトの場合は要素が見つからなかった
          logger.debug(e.message);
          let bodyHTML = await page.evaluate(() => document.body.innerHTML);
          logger.debug(bodyHTML);
        }
        logger.debug(88);
        await page.waitForSelector('p.bingo__btnWrapper', {visible: true})
          .then(el => el.click());
        logger.debug(89);
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // タイムアウトの場合は次の処理へ進む
        logger.debug(e.message);
      }
      await page.waitFor(5000); // 5秒待ち
    }

    // クリックで貯める
    async function click(page) {
      logger.debug('click()');
      await page.goto('http://pc.moppy.jp/cc/');
      logger.debug('click() 1');
      const anchors = await page.$$('div.main a.coin-every');
      for (let a of anchors) {
        logger.debug('click() 2');
        let newPage;
        [newPage] = await Promise.all([
          // 新ウインドウ遷移（target=_blank）待ち
          new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
          a.click()
        ]);
        logger.debug('click() 3');
        await newPage.waitFor(15000); // 15秒待ち（遷移待ち）
        logger.debug('click() 4');
        await newPage.close(); // 新ウインドウを消す
        logger.debug('click() 5');
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
