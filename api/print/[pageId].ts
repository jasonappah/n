import { NextApiRequest, NextApiResponse } from 'next'
import chromium from 'chrome-aws-lambda'
const fs = require('fs')
const fsPromises = require("fs/promises")

interface PDFGen {
  page: String,
  path: String
}

export default async (req: NextApiRequest, res: NextApiResponse) => {
  const regex = /[^A-Za-z0-9]/
  const pageId = req.query.pageId as string || "b7b46e3339f04662b52c7a700d22a338"

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
    if (filename in printFolder) {
      const stats = await fsPromises.lstat(filePath)
      if (new Date().getTime() - stats.mtime.getTime() > resetCacheMs) {
        PAGE_EXISTS = false
      } else {
        pdf = await fsPromises.readFile(filePath)
      }
    } else {
      PAGE_EXISTS = false
    }
  } catch {
    PAGE_EXISTS = false
  }
  // if so, try to open the file in the cache. if there's an error, the file is not cached, so set this var to false
  // if there's no error, then check if the file was cached in the last 30 minutes.
  // if so, take the file and set pdf to the file, if not, we want to update the cache so delete and overwrite the file


  if (!PAGE_EXISTS) {
    pdf = await createPDF({
      page: pageId,
      path: filePath
    })
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
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: true, // chromium.headless,
      ignoreHTTPSErrors: true
    })

    // make page into pdf and set res to be it. 
    // also write the file to our cache

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 0.85 });
    await page.goto(`https://notion.so/${params.page}`, { waitUntil: 'networkidle0' });
    res = await page.pdf({ format: 'Letter' });
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
