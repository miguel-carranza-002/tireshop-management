import { useState } from 'react'
import { api, type Season, type TireType, type TireLine, type TireLineInput } from '../../api'
import { Alert, Button, FormField, InputAffix, Modal } from '../../ui'
import { seasonLabels, tireTypeLabels } from './tireSpec'

type Props = {
  line: TireLine
  // Also called on close, with any photo change already saved.
  onSaved: (line: TireLine) => void
}

// Shrink a photo to at most 800px on its long side and re-encode as JPEG,
// so a phone picture becomes ~100 KB before it's uploaded.
async function resizedDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

// Edit what every size of a tire line shares, and its tread photo.
function TireLineDialog({ line, onSaved }: Props) {
  const [form, setForm] = useState<TireLineInput>({
    brand: line.brand,
    model: line.model,
    tireType: line.tireType ?? '',
    season: line.season ?? '',
    warrantyMiles: line.warrantyMiles,
    roadHazard: line.roadHazard,
    runFlat: line.runFlat,
    evRated: line.evRated,
    severeSnow: line.severeSnow,
    notes: line.notes ?? '',
  })
  const [current, setCurrent] = useState(line)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (patch: Partial<TireLineInput>) => setForm((f) => ({ ...f, ...patch }))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      onSaved((await api.saveTireLine(line.id, form)).line)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the tire line')
      setBusy(false)
    }
  }

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    try {
      const updated = (await api.uploadTireLinePhoto(line.id, await resizedDataUrl(file))).line
      setCurrent(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the photo')
    } finally {
      setBusy(false)
    }
  }

  async function removePhoto() {
    setBusy(true)
    try {
      setCurrent((await api.deleteTireLinePhoto(line.id)).line)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      width={640}
      title={`${line.brand} ${line.model}`}
      onClose={() => onSaved(current)}
      onSubmit={() => void save()}
      footer={
        <>
          <Button variant="ghost" onClick={() => onSaved(current)}>
            Close
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="tl-photo-row">
        <div className="tl-photo">
          {current.hasPhoto ? (
            <img src={api.tireLinePhotoUrl(current.id, current.photoUpdatedAt)} alt={`${line.brand} ${line.model} tread`} />
          ) : (
            <span>No photo</span>
          )}
        </div>
        <div className="tl-photo-actions">
          <label className="ui-btn ui-btn-secondary">
            {current.hasPhoto ? 'Replace photo' : 'Add tread photo'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void upload(file)
                e.target.value = ''
              }}
            />
          </label>
          {current.hasPhoto && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void removePhoto()}>
              Remove photo
            </Button>
          )}
          <p className="ed-muted">Shown to customers when comparing tires. Use your own photo or one your supplier lets you use.</p>
        </div>
      </div>

      <div className="ui-form-grid">
        <FormField label="Brand" required>
          <input value={form.brand} onChange={(e) => set({ brand: e.target.value })} />
        </FormField>
        <FormField label="Model" required hint={`Renaming changes all ${line.sizeCount} size${line.sizeCount === 1 ? '' : 's'}`}>
          <input value={form.model} onChange={(e) => set({ model: e.target.value })} />
        </FormField>
        <FormField label="Type">
          <select value={form.tireType} onChange={(e) => set({ tireType: e.target.value as TireType | '' })}>
            <option value="">Not set</option>
            {(Object.keys(tireTypeLabels) as TireType[]).map((t) => (
              <option key={t} value={t}>
                {tireTypeLabels[t]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Season">
          <select value={form.season} onChange={(e) => set({ season: e.target.value as Season | '' })}>
            <option value="">Not set</option>
            {(Object.keys(seasonLabels) as Season[]).map((s) => (
              <option key={s} value={s}>
                {seasonLabels[s]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Warranty" hint="Sizes with their own warranty keep it">
          <InputAffix
            suffix="miles"
            inputMode="numeric"
            value={form.warrantyMiles === null ? '' : String(form.warrantyMiles)}
            onChange={(e) => set({ warrantyMiles: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </FormField>
        <div className="pf-checks ui-field-wide tl-checks">
          <label className="pf-check">
            <input type="checkbox" checked={form.roadHazard} onChange={(e) => set({ roadHazard: e.target.checked })} /> Road hazard included
          </label>
          <label className="pf-check">
            <input type="checkbox" checked={form.severeSnow} onChange={(e) => set({ severeSnow: e.target.checked })} /> Severe snow (3PMSF)
          </label>
          <label className="pf-check">
            <input type="checkbox" checked={form.runFlat} onChange={(e) => set({ runFlat: e.target.checked })} /> Run-flat
          </label>
          <label className="pf-check">
            <input type="checkbox" checked={form.evRated} onChange={(e) => set({ evRated: e.target.checked })} /> EV-rated
          </label>
        </div>
        <FormField label="Notes" wide>
          <textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </FormField>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </Modal>
  )
}

export default TireLineDialog
