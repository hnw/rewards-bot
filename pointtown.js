const prog_id = 'pointtown';
const site_name = 'ポイントタウン';
const rate = 0.05;
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
    await amazon(page);
    await competition(page);
    await pointq(page);
    await click_top(page);
    await click_service(page);
    await click_mypage(page);
    await click_mailbox(page);
    await pointchance(page);
    await usapo(page);
    await kuji(page);
    await collection(page);
    await stamprally(page);
    await page.waitFor(10000); // 10秒待ち（ポイント反映待ち）
    const currPoint = await getCurrentPoint(page);
    const earnedPoint = calcEarnedPoint(prevPoint, currPoint);
    if (earnedPoint !== 0.0) {
      const earnedYen = calcEarnedYen(earnedPoint, rate);
      logger.info(`${earnedPoint}pt（${earnedYen}円）を獲得しました`);
    }

    // ログインページ
    async function login(page) {
      logger.debug('login()');
      await page.goto('https://www.pointtown.com/ptu/mypage/top.do');

      // GMOログインページ
      logger.debug(1);
      await page.waitForSelector('form[name="LineLoginForm"]', {visible: true})
        .then(el => el.click());
      await line_login(page);
      // 秘密の質問
      const secretAnswer = process.env.POINTTOWN_SECRET_ANSWER;
      const birthday = new Date(process.env.POINTTOWN_BIRTHDAY);
      await page.waitForSelector('input[name="answer"]', {visible: true})
        .then(el => el.type(secretAnswer));
      console.log(5);
      console.log(birthday.getFullYear());
      await page.type('input[name="birth_year"]', birthday.getFullYear()+'');
      console.log(6);
      console.log(birthday.getMonth()+1+'');
      await page.select('select[name="birth_month"]', birthday.getMonth()+1+'');
      console.log(7);
      console.log(birthday.getDate()+'');
      await page.select('select[name="birth_day"]', birthday.getDate()+'');
      console.log(8);
      await Promise.all([
        page.waitForNavigation({waitUntil: "domcontentloaded"}),
        page.click('input[type="image"]')
      ]);
    }

    // LINEログイン
    async function line_login(page) {
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

    // 現在ポイントを取得
    async function getCurrentPoint(page) {
      logger.debug('getCurrentPoint()');
      await page.goto('https://www.pointtown.com/ptu/mypage/point_history');

      let nPointText = await page.$eval('dd.pt-definition-alignment__desc', el => el.textContent);
      if (!/^\s*[\d,]+pt/.test(nPointText)) {
        // 例外を投げるべきかもしれない…
        return -1;
      }
      nPointText = nPointText.replace(/pt.*$/, '').replace(/[,\s]/g, '');
      const nPoint = parseInt(nPointText, 10);

      return nPoint;
    }

    // Amazon商品検索
    async function amazon(page) {
      logger.debug('amazon()');
      const candidates = ['飲料', '電池', '洗剤'];
      const searchWord = candidates[Math.floor(Math.random() * candidates.length)];
      await page.goto('https://www.pointtown.com/ptu/amazon-search');
      await page.waitForSelector('input[name="field-keywords-header"]', {visible: true})
        .then(el => el.type(searchWord));
      await Promise.all([
        page.waitForNavigation({waitUntil: "domcontentloaded"}),
        page.click('input[type="button"]')
      ]);
    }

    // ポイント争奪戦
    async function competition(page) {
      logger.debug('competition()');
      await page.goto('https://www.pointtown.com/ptu/competition/entry.do');
      try {
        await page.waitForSelector('.competitionArea a[href*="complete.do"]', {visible: true, timeout: 10000})
          .then(el => el.click());
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // タイムアウトの場合は既に本日実施済み？
        logger.debug(e.message);
      }
    }

    // ポイントQ
    async function pointq(page) {
      logger.debug('pointq()');
      await page.goto('https://www.pointtown.com/ptu/quiz/input.do');
      const labels = await page.$$('form label p');
      if (labels.length >= 1) {
        const i = Math.floor(Math.random() * labels.length);
        await labels[i].click();
      }
      await page.click('.answer_btn a');
    }

    // スタンプラリーのポイント回収
    async function stamprally(page) {
      logger.debug('stamprally()');
      await page.goto('https://www.pointtown.com/ptu/mypage/top');
      try {
        await page.waitForSelector('a.stamp-cl-btn', {visible: true, timeout: 10000})
          .then(el => el.click())
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // タイムアウトの場合は次の処理へ進む
        logger.debug(e.message);
      }
    }

    // クリックコーナー（トップページ中段）
    async function click_top(page) {
      logger.debug('click_top()');
      await page.goto('https://www.pointtown.com/ptu/top');
      let newPage;
      [newPage] = await Promise.all([
        // 新ウインドウ遷移（target=_blank）待ち
        new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
        page.click('.pt-card a[href*="clickCorner"]')
      ]);
      await newPage.waitFor(15000); // 15秒待ち（遷移待ち）
      await newPage.close(); // 新ウインドウを消す

    }
    
    // クリックコーナー（サービスページ下）
    async function click_service(page) {
      logger.debug('click_service()');
      await page.goto('https://www.pointtown.com/ptu/service');
      const anchors = await page.$$('a[href*="clickCornerFooter"]');
      for (let a of anchors) {
        let newPage1,newPage2;
        [newPage1] = await Promise.all([
          // 新ウインドウ遷移（target=_blank）待ち
          new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
          a.click()
        ]);
        [newPage2] = await Promise.all([
          // 新ウインドウ遷移（target=_blank）待ち
          new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
          newPage1.waitForSelector('.pt-btn-action a', {visible: true})
            .then(el => el.click())
        ]);
        await newPage2.waitFor(15000); // 15秒待ち（遷移待ち）        
        await newPage2.close(); // 新ウインドウを消す
        await newPage1.close(); // 新ウインドウを消す
      }
    }

    // クリックコーナー（マイページ）
    async function click_mypage(page) {
      logger.debug('click_mypage()');
      await page.goto('https://www.pointtown.com/ptu/mypage/top');
      let newPage;
      [newPage] = await Promise.all([
        // 新ウインドウ遷移（target=_blank）待ち
        new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
        page.click('#myPgPickUpBx a img')
      ]);
      await newPage.waitFor(15000); // 15秒待ち（遷移待ち）
      await newPage.close(); // 新ウインドウを消す
    }

    // クリックコーナー（メールボックス）
    async function click_mailbox(page) {
      logger.debug('click_mailbox()');
      await page.goto('https://www.pointtown.com/ptu/mailbox');
      let newPage;
      [newPage] = await Promise.all([
        // 新ウインドウ遷移（target=_blank）待ち
        new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
        page.click('#clickBx3 a img')
      ]);
      await newPage.waitFor(15000); // 15秒待ち（遷移待ち）
      await newPage.close(); // 新ウインドウを消す
    }

    // ベジモンコレクション
    async function collection(page) {
      logger.debug('collection()');
      await page.goto('https://www.pointtown.com/ptu/collection/index.do');
      const anchors = await page.$$('.bnArea a img');
      for (let a of anchors) {
        let newPage;
        [newPage] = await Promise.all([
          // 新ウインドウ遷移（target=_blank）待ち
          new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
          a.click()
        ]);
        await newPage.waitFor(15000); // 15秒待ち（遷移待ち）        
        await newPage.close(); // 新ウインドウを消す
      }
    }

    // 三角くじ
    async function kuji(page) {
      logger.debug('kuji()');
      for (let i = 1; i <= 6; i++) {
        await page.goto('https://www.pointtown.com/ptu/mypage/top');
        await page.waitForSelector(`ul li:nth-child(${i}) a.game-items-kuji`, {visible: true})
          .then(el => el.click());
        try {
          await page.waitForSelector('img[src*="kuji/kuji-"]', {visible: true, timeout: 10000})
            .then(img => img.click());
          let newPage;
          [newPage] = await Promise.all([
            // 新ウインドウ遷移（target=_blank）待ち
            new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
            page.waitForSelector('#clickBx2 a img', {visible: true, timeout: 10000})
              .then(img => img.click())
          ]);
          await newPage.waitFor(15000); // 15秒待ち（遷移待ち）
          await newPage.close(); // 新ウインドウを消す
          await page.waitForSelector('img[src*="kuji-w.png"]', {visible: true, timeout: 10000})
            .then(img => img.click());
        } catch (e) {
          if (!(e instanceof TimeoutError)) { throw e; }
          // タイムアウトの場合は次の処理へ進む
          logger.debug(e.message);
        }
        await page.waitFor(2000); // 2秒待ち（遷移待ち）
      }
    }

    // うさぽくじ
    async function usapo(page) {
      logger.debug('usapo()');
      await page.goto('https://www.pointtown.com/ptu/travel');
      try {
        await page.waitForSelector('img[src*="kuji_usapo.gif"]', {visible: true, timeout: 10000})
          .then(img => img.click());
        let newPage;
        [newPage] = await Promise.all([
          // 新ウインドウ遷移（target=_blank）待ち
          new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
          page.waitForSelector('#clickBx2 a img', {visible: true, timeout: 10000})
            .then(img => img.click())
        ]);
        await newPage.waitFor(15000); // 15秒待ち（遷移待ち）
        await newPage.close(); // 新ウインドウを消す
        await page.waitForSelector('img[src*="kuji_kumapo.gif"]', {visible: true, timeout: 10000})
          .then(img => img.click());
      } catch (e) {
        if (!(e instanceof TimeoutError)) { throw e; }
        // タイムアウトの場合は次の処理へ進む
        logger.debug(e.message);
      }
      await page.waitFor(15000); // 15秒待ち（遷移待ち）
    }

    async function pointchance(page) {
      logger.debug('pointchance()');
      await page.goto('https://www.pointtown.com/ptu/shufoo/index.do');
      const anchors = await page.$$('li.pointchanceItem');
      for (let a of anchors) {
        let newPage,newPage2;
        [newPage] = await Promise.all([
          // 新ウインドウ遷移（target=_blank）待ち
          new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
          a.click()
        ]);
        await newPage.waitFor(15000); // 15秒待ち（遷移待ち）        
        await newPage.close(); // 新ウインドウを消す
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
