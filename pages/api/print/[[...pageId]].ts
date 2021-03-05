import Cors from 'cors'
import { NextApiRequest, NextApiResponse } from 'next'
import chromium from 'chrome-aws-lambda'
const cors = Cors()
const fsPromises = require("fs/promises").promises;

interface PDFGen {
  page: String,
  path: String
}

// Helper method to wait for a middleware to execute before continuing
// And to throw an error when an error happens in a middleware
function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) {
        return reject(result)
      }

      return resolve(result)
    })
  })
}

export default async (req: NextApiRequest, res: NextApiResponse) => {
  await runMiddleware(req, res, cors)
  const fallbackPageId = "b7b46e3339f04662b52c7a700d22a338"
  const regex = /[^A-Za-z0-9]/
  var pageId = ""
  try {
    pageId = req.query.pageId[0] as string
  } catch {
    pageId = fallbackPageId
  }

  if (pageId == "help" || pageId == "h") {
    pageId = fallbackPageId
  }

  if (regex.test(pageId)) {
    return res.status(400).send({ error: 'This page id contains non-alphanumeric characters. Please remove them and try again.' })
  }

  const filename = `${pageId}.pdf`
  const folderPath = 'public/print'
  const filePath = `${folderPath}/${filename}`

  // 15 minutes -> convert to secs -> convert to millisecs
  const resetCacheMs = 15 * 60 * 1000

  var pdf;
  var PAGE_EXISTS = true;

  try {
    const printFolder = await fsPromises.readdir(folderPath)
    console.log(printFolder)
    const check = printFolder.includes(filename)
    if (check) {
      const stats = await fsPromises.lstat(filePath)
      if (new Date().getTime() - stats.mtime.getTime() > resetCacheMs) {
        PAGE_EXISTS = false
      } else {
        pdf = await fsPromises.readFile(filePath)
      }
    } else {
      PAGE_EXISTS = false
    }
  } catch (e) {
    PAGE_EXISTS = false
    console.log(e)
  }

  // if so, try to open the file in the cache. if there's an error, the file is not cached, so set this var to false
  // if there's no error, then check if the file was cached in the last 30 minutes.
  // if so, take the file and set pdf to the file, if not, we want to update the cache so delete and overwrite the file


  if (!PAGE_EXISTS) {
    console.log("Creating PDF for file", filename)
    pdf = await createPDF({
      page: pageId,
      path: filePath
    })
  } else {
    console.log("Pulling PDF from cache for file", filename)
  }

  res.setHeader('Content-Type', 'application/pdf')
  res.status(200).send(pdf)
}

async function createPDF(params: PDFGen) {
  let browser, res

  try {
    // add font support for emojis
    // @see https://github.com/alixaxel/chrome-aws-lambda#fonts
    await chromium.font(
      'https://raw.githack.com/googlei18n/noto-emoji/master/fonts/NotoColorEmoji.ttf'
    )

    browser = await chromium.puppeteer.launch({
      args: [...chromium.args, '--no-sandbox'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: true, // chromium.headless,
      ignoreHTTPSErrors: true,
    })

    // make page into pdf and set res to be it. 
    // also write the file to our cache
    const newMargin = "0.5in"
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    
    const css = `body, div, article, header, p, h1, h2, h3, h4, h5, h6, a { font-family: "Inter", sans-serif !important; }`

    const js = `document.head.insertAdjacentHTML("beforeend", '<link rel="preconnect" href="https://fonts.gstatic.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap" rel="stylesheet"><style>${css}</style>')`
    console.log(js)
    await page.goto(`https://notion.so/${params.page}`, { waitUntil: 'networkidle0' });
    
    await page.evaluate(js);

    res = await page.pdf({
      format: 'Letter', scale: 0.85, margin: {
        top: newMargin, bottom: newMargin, left: newMargin, right: newMargin
      }
    });
    
    return res

  } finally {
    if (browser) {
      await browser.close()
    }
    if (res) {
      await fsPromises.writeFile(params.path, res)
    }
  }
}
