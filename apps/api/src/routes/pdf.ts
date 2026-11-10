import { Router } from 'express'
import { pool } from '../db.js'
import { documentNumber, renderTicketPdf, type PdfTicket } from '../pdf/ticketPdf.js'
import { idParam } from '../validation.js'
import { loadShopDetails } from './settings.js'
import { loadTicketDetail } from './tickets.js'

// Mounted on /api/tickets: GET /:id/pdf (add ?download=1 to save instead of view).
export const pdfRouter = Router()

pdfRouter.get('/:id/pdf', async (req, res) => {
  const id = idParam(req.params.id)
  const [ticket, shop] = await Promise.all([loadTicketDetail(pool, id), loadShopDetails()])
  const filename = `${documentNumber(ticket as PdfTicket)}.pdf`
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader(
    'Content-Disposition',
    `${req.query.download ? 'attachment' : 'inline'}; filename="${filename}"`,
  )
  const doc = renderTicketPdf(ticket as PdfTicket, shop)
  doc.pipe(res)
  doc.end()
})
