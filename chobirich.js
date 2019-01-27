const prog_id = 'chobirich'
const site_name = 'ちょびリッチ'
const rate = 0.5
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
    await tokusen(page);
    await stamp(page);
    await bingo(page);
    const currPoint = await getCurrentPoint(page);
    const earnedPoint = calcEarnedPoint(prevPoint, currPoint);
    if (earnedPoint !== 0.0) {
      const earnedYen = calcEarnedYen(earnedPoint, rate);
      logger.info(`${earnedPoint}pt（${earnedYen}円）を獲得しました`);
    }

    // ログインページ
    async function login(page) {
      logger.debug('login()');
      await page.goto('https://www.chobirich.com/connect/with/yahoo', {waitUntil: "domcontentloaded"});

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
      await page.goto('http://www.chobirich.com/mypage/point_details/stamp/', {waitUntil: "domcontentloaded"});
      const nPointText = (await page.$eval('div.mypage_navi span.user_pt_n', el => el.textContent)).replace(/[,\s]/g, '');
      const nPoint = parseInt(nPointText, 10);
      const nStamp = (await page.$$('div.detail_stamp_list td img')).length;

      const currPoint = (nPoint * 10 + nStamp) / 10;
      logger.debug(`currPoint = ${currPoint}`);
      return currPoint;
    }

    // 特選バナー
    async function tokusen(page) {
      logger.debug('tokusen()');
      await page.goto('http://www.chobirich.com/', {waitUntil: "domcontentloaded"});

      let newPage;
      try {
        [newPage] = await Promise.all([
          // 新ウインドウ遷移（target=_blank）待ち
          new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
          page.waitForSelector('div.tokusen_bnr_r a[href*="/cm/click"]', {visible: true})
            .then(a => a.click())
        ]);
        await newPage.waitFor(3000); // 3秒待ち（本当はdocumentloadedを待ちたい）
        // 新ウインドウを消す
        await newPage.close();
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // タイムアウトの場合は新ウインドウが開いていないので何もしない
        logger.debug(e.message);
      }
    }

    // スタンプゲット
    async function stamp(page) {
      logger.debug('stamp()');
      await page.goto('http://www.chobirich.com/earn', {waitUntil: "domcontentloaded"});
      const images = await page.$$('div.clickstamp_list img');
      for (let image of images) {
        let newPage;
        [newPage] = await Promise.all([
          // 新ウインドウ遷移（target=_blank）待ち
          new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
          image.click()
        ]);
        await newPage.waitFor(15000); // 15秒待ち
        await newPage.close(); // 新ウインドウを消す
      }
    }

    // ビンゴ（3時更新）
    async function bingo(page) {
      logger.debug('bingo()');
      await page.goto('http://www.chobirich.com/game/bingo/', {waitUntil: "domcontentloaded"});
      // iframeを取り出す
      await page.waitForSelector('iframe[src*="ebingo.jp"]', {visible:true});
      const frame = await waitForFrame(page, f => /ebingo\.jp/.test(f.url()));
      let newlyMarked = false;
      // 初日のみ「参加する」ボタンを押す
      try {
        const joinButton = await frame.waitForSelector('input[value*="今すぐ参加する"]', {visible: true, timeout: 10000});
        await joinButton.click();
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // 既に「参加する」ボタンが押されている?
        logger.debug(e.message);
      }
      // 当選ビンゴマスがあるかぎりクリック
      try {
        for (let i = 0; i < 5; i++) {
          const img = await frame.waitForSelector('td a img[src*="/bingo/card/"]',
                                                  {visible: true, timeout: 10000});
          await img.click()
          await page.waitFor(10000); // 10秒待ち（ページ遷移待ち、他にうまい手が思いつかず）
          newlyMarked = true;
        }
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // 当選ビンゴマスがなくなったらタイムアウトで抜ける
        logger.debug(e.message);
      }

      // BINGOシートをSlackに送信
      if (newlyMarked) {
        const bingoCell = await frame.$('tbody img[src*="/bingo/card/0.gif"]');
        const bingoSheet = await frame.evaluateHandle(el => el.closest('tbody'), bingoCell);
        //await my.uploadScreenShot(bingoSheet, 'bingo.png');
      }

      // BINGOボタンをクリック（BINGO達成時のみ表示）
      try {
        const button = await frame.waitForSelector('input[src*="bingo.gif"]',
                                                   {visible: true, timeout: 10000});
        await Promise.all([
          page.waitForNavigation({waitUntil: "domcontentloaded"}),
          button.click()
        ]);
        await page.waitFor(60000); // 60秒待ち（成果反映待ち）
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // BINGOボタンが見つからなかったらタイムアウトで抜ける
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
  } catch (e) {
    logger.error(e);
  } finally {
    logger.debug('The script is finished.');
    if (!argv.debug) {
      await browser.close();
    }
  }
})();
