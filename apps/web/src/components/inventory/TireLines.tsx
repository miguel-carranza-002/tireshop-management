import { useEffect, useState } from 'react'
import { api, type TireLine } from '../../api'
import { Alert, Badge, Button, EmptyState, Table } from '../../ui'
import TireLineDialog from './TireLineDialog'
import { kindLabel } from './tireSpec'

// Every brand + model, with what its sizes share and its tread photo.
function TireLines() {
  const [lines, setLines] = useState<TireLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<TireLine | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api
      .listTireLines(controller.signal)
      .then((r) => setLines(r.lines))
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load tire lines')
      })
    return () => controller.abort()
  }, [])

  if (error) return <Alert tone="danger">{error}</Alert>
  if (!lines) return <EmptyState title="Loading…" />
  if (lines.length === 0) {
    return <EmptyState title="No tire lines yet.">A tire line is created when you add the first size of a brand and model.</EmptyState>
  }

  return (
    <>
      <Table>
        <thead>
          <tr>
            <th scope="col">Photo</th>
            <th scope="col">Tire line</th>
            <th scope="col">Type · season</th>
            <th scope="col" className="num">
              Warranty
            </th>
            <th scope="col">Features</th>
            <th scope="col" className="num">
              Sizes
            </th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="tl-thumb-cell">
                {l.hasPhoto ? (
                  <img className="tl-thumb" src={api.tireLinePhotoUrl(l.id, l.photoUpdatedAt)} alt="" />
                ) : (
                  <span className="tl-thumb tl-thumb-empty" />
                )}
              </td>
              <td>
                <strong>{l.brand}</strong> {l.model}
              </td>
              <td>{kindLabel(l) || <span className="ed-muted">—</span>}</td>
              <td className="num">
                {l.warrantyMiles === null ? '—' : l.warrantyMiles === 0 ? 'None' : `${l.warrantyMiles.toLocaleString()} mi`}
              </td>
              <td>
                <span className="tl-badges">
                  {l.roadHazard && <Badge tone="success">Road hazard</Badge>}
                  {l.severeSnow && <Badge>3PMSF</Badge>}
                  {l.runFlat && <Badge>Run-flat</Badge>}
                  {l.evRated && <Badge>EV</Badge>}
                </span>
              </td>
              <td className="num">{l.sizeCount}</td>
              <td className="num">
                <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>
                  Edit
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && (
        <TireLineDialog
          line={editing}
          onSaved={(saved) => {
            setLines((list) => (list ?? []).map((l) => (l.id === saved.id ? saved : l)))
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

export default TireLines
