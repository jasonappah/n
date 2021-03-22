import Cors from 'cors'
import { NextApiRequest, NextApiResponse } from 'next'
import chromium from 'chrome-aws-lambda'
import { PDFDocument, rgb } from 'pdf-lib'
const cors = Cors()
const fsPromises = require('fs').promises

interface PDFGen {
  page: string
  path: string
  dark: boolean
  omitFinalPage: boolean
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

interface Pdf {
  res: Buffer | Uint8Array
  name: string
}

export default async (req: NextApiRequest, res: NextApiResponse) => {
  await runMiddleware(req, res, cors)
  const fallbackPageId = 'b7b46e3339f04662b52c7a700d22a338'
  const regex = /[^A-Za-z0-9]/
  let pageId = ''
  try {
    pageId = req.query.pageId[0] as string
  } catch {
    pageId = fallbackPageId
  }

  if (pageId === 'help' || pageId === 'h') {
    pageId = fallbackPageId
  }

  if (regex.test(pageId)) {
    return res.status(400).send({
      error:
        'This page id contains non-alphanumeric characters. Please remove them and try again.'
    })
  }

  console.log(req.query)
  const darkMode = typeof req.query.dark === 'string'
  const omitFinalPage = typeof req.query.omitFinalPage === 'string'
  const filename = `${pageId}${darkMode ? '-dark' : ''}.pdf`
  const folderPath = 'public/print'
  const filePath = `${folderPath}/${filename}`

  // 15 minutes -> convert to secs -> convert to millisecs
  const resetCacheMs = 15 * 60 * 1000
  let pdf: Pdf
  let PAGE_EXISTS = true

  try {
    const printFolder = await fsPromises.readdir(folderPath)
    const check = printFolder.includes(filename)
    if (check) {
      const stats = await fsPromises.lstat(filePath)
      if (new Date().getTime() - stats.mtime.getTime() > resetCacheMs) {
        PAGE_EXISTS = false
      } else {
        const data = await fsPromises.readFile(filePath)
        const doc = await PDFDocument.load(data)
        pdf = { res: data, name: doc.getTitle() || 'Document' }
      }
    } else {
      PAGE_EXISTS = false
    }
  } catch (e) {
    PAGE_EXISTS = false
    console.log(e)
    return res.status(400).send({ error: e })
  }

  // if so, try to open the file in the cache. if there's an error, the file is not cached, so set this var to false
  // if there's no error, then check if the file was cached in the last 30 minutes.
  // if so, take the file and set pdf to the file, if not, we want to update the cache so delete and overwrite the file

  if (!PAGE_EXISTS) {
    console.log('Creating PDF for file', filename)
    pdf = await createPDF({
      page: pageId,
      path: filePath,
      dark: darkMode,
      omitFinalPage
    })
  } else {
    console.log('Pulling PDF from cache for file', filename)
  }

  res.setHeader('Content-Disposition', `inline; filename="${pdf.name}.pdf"`)
  res.setHeader('Content-Type', 'application/pdf')

  res.status(200).send(Buffer.from(pdf.res))
}

async function createPDF(params: PDFGen): Promise<Pdf> {
  let browser, res, fixedRes

  try {
    // add font support for emojis
    // @see https://github.com/alixaxel/chrome-aws-lambda#fonts
    await chromium.font(
      'https://raw.githack.com/googlei18n/noto-emoji/master/fonts/NotoColorEmoji.ttf'
    )

    browser = await chromium.puppeteer.launch({
      args: [...chromium.args, '--font-render-hinting=none'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: true, // chromium.headless,
      ignoreHTTPSErrors: true
    })

    // make page into pdf and set res to be it.
    // also write the file to our cache
    const page = await browser.newPage()

    const css = `body, div, article, header, p, h1, h2, h3, h4, h5, h6, a, span, footer, aside { font-family: "Inter", sans-serif !important; } div.notion-page-controls {margin-top: 15px !important; height: 0px !important;} div.notion-page-details-controls { padding-bottom: 5px !important; } div.notion-column_list-block > div > div { padding-top: 0px !important;} body > :last-child: { margin-bottom: -1px; overflow: hidden; }`
    const js = `document.head.insertAdjacentHTML("beforeend", '<link rel="preconnect" href="https://fonts.gstatic.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap" rel="stylesheet"><style>${css}</style>')`
    const getName = `document.getElementsByClassName("notion-page-block")[0].innerText`
    await page.goto(`https://notion.so/${params.page}`, {
      waitUntil: 'networkidle0'
    })

    if (params.dark) {
      const darkModeKeys = ['Control', 'Shift', 'l']
      darkModeKeys.map(async (press) => {
        await page.keyboard.down(press)
      })
    }

    await page.evaluate(js)
    let name
    try {
      name = await page.evaluate(getName)
    } catch {
      name = 'Document'
    }
    // just to make the page wait for the fonts to load in
    await page.screenshot()

    res = await page.pdf({
      format: 'Letter',
      displayHeaderFooter: false,
      scale: 0.75,
      printBackground: false,
      margin: {
        top: '0cm',
        left: '0cm',
        bottom: '0cm',
        right: '0cm'
      }
    })
    const content = await PDFDocument.load(res)
    const count = content.getPageCount()

    // this is awfully hacky, but like, it works.
    // eventually i will figure out what is causing the white bars on the top and bottom of each page,
    // but for now we'll leave it alone ;)
    if (params.dark) {
      const rect = {
        x: 0,
        y: 0,
        width: 250,
        height: 60,
        borderWidth: 0,
        color: rgb(47.0 / 255.0, 52.0 / 255.0, 55.0 / 255.0),
        opacity: 1
      }
      content.getPages().map((page) => {
        rect.width = page.getWidth()
        page.drawRectangle(rect)
        page.drawRectangle({ ...rect, y: page.getHeight() - rect.height })
      })
    }

    if (params.omitFinalPage) {
      content.removePage(count - 1)
    }
    content.setTitle(name)
    fixedRes = await content.save()
    return { res: fixedRes, name }
  } finally {
    if (browser) {
      await browser.close()
    }
    if (res) {
      await fsPromises.writeFile(params.path, fixedRes)
    }
  }
}
