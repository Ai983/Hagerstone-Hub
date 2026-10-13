import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { CheckCircle, Circle, AlertTriangle, LocateFixed, Search, Link2 } from 'lucide-react'

// Creates a site in every system at once through public.admin_add_site:
// project list (Expenses & Imprest), CPS (via trg_sync_project_to_cps) and the
// attendance geofence (hr.sites). Admin-only; the RPC records who added it.

type Provider = 'gps' | 'manual' | 'nominatim'
type Loc = { lat: number; lng: number; provider: Provider; label: string }

export type CreatedSite = { site_id: string; project_id: string; cps_project_id: string; code: string; name: string }

const RADIUS_OPTS = [
  [200, 'Small site / office (200 m)'],
  [300, 'Normal site (300 m)'],
  [500, 'Large site (500 m)'],
  [1000, 'Township / very large (1 km)'],
] as const

// Accepts "28.32, 77.05", a Google Maps URL (@lat,lng or ?q=lat,lng or !3dlat!4dlng).
function parseLatLng(text: string): { lat: number; lng: number } | null {
  const t = text.trim()
  const pats = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
    /[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
    /^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/,
  ]
  for (const p of pats) {
    const m = t.match(p)
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
  }
  return null
}

const inIndia = (l: { lat: number; lng: number }) => l.lat >= 6 && l.lat <= 37 && l.lng >= 68 && l.lng <= 98

export function AddSiteDialog({ open, onOpenChange, onCreated }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (site: CreatedSite) => void
}) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [pincode, setPincode] = useState('')
  const [incharge, setIncharge] = useState('')
  const [contact, setContact] = useState('')
  const [radius, setRadius] = useState<number>(300)
  const [loc, setLoc] = useState<Loc | null>(null)
  const [mapsText, setMapsText] = useState('')
  const [busy, setBusy] = useState<'gps' | 'search' | null>(null)

  const reset = () => {
    setName(''); setAddress(''); setPincode(''); setIncharge(''); setContact('')
    setRadius(300); setLoc(null); setMapsText(''); setBusy(null)
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) return toast.error('This browser cannot read your location')
    setBusy('gps')
    navigator.geolocation.getCurrentPosition(
      p => {
        setBusy(null)
        setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, provider: 'gps', label: `Your current location (±${Math.round(p.coords.accuracy)} m)` })
      },
      err => { setBusy(null); toast.error(`Could not get location: ${err.message}`) },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const findFromAddress = async () => {
    const q = [address, pincode, 'India'].filter(Boolean).join(', ')
    if (!address.trim() && !pincode.trim()) return toast.error('Type the address or pincode first')
    setBusy('search')
    try {
      // Try full address first, fall back to just the pincode.
      for (const query of [q, pincode ? `${pincode}, India` : null].filter(Boolean) as string[]) {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`)
        const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[]
        if (rows[0]) {
          setLoc({ lat: +rows[0].lat, lng: +rows[0].lon, provider: 'nominatim', label: `Approx: ${rows[0].display_name}` })
          return
        }
      }
      toast.error('Could not find that address on the map. Paste a Google Maps link instead.')
    } catch {
      toast.error('Map search failed. Paste a Google Maps link instead.')
    } finally {
      setBusy(null)
    }
  }

  const applyMapsText = (text: string) => {
    setMapsText(text)
    const p = parseLatLng(text)
    if (p) setLoc({ ...p, provider: 'manual', label: 'From pasted Google Maps link / coordinates' })
  }

  const checks: { ok: boolean; warn?: boolean; text: string }[] = [
    { ok: name.trim().length >= 3, text: name.trim().length >= 3 ? `Name: ${name.trim()}` : 'Enter the site name' },
    { ok: !!address.trim(), text: address.trim() ? 'Address filled' : 'Enter the site address' },
    { ok: true, warn: !/^\d{6}$/.test(pincode), text: /^\d{6}$/.test(pincode) ? `Pincode ${pincode}` : 'Pincode missing (recommended)' },
    loc
      ? inIndia(loc)
        ? { ok: true, warn: loc.provider === 'nominatim', text: loc.provider === 'nominatim' ? 'Location is approximate — attendance may fail at the gate. Better: use location at site or paste Maps link.' : 'Location set' }
        : { ok: false, text: 'Location is outside India — check the link' }
      : { ok: false, text: 'Set the site location (needed for attendance)' },
  ]
  const blocking = checks.filter(c => !c.ok).length

  const save = useMutation({
    mutationFn: async () => {
      const fullAddress = pincode && !address.includes(pincode) ? `${address.trim()} - ${pincode}` : address.trim()
      const { data, error } = await supabase.rpc('admin_add_site', {
        p_name: name.trim(),
        p_address: fullAddress,
        p_latitude: loc!.lat,
        p_longitude: loc!.lng,
        p_radius_meters: radius,
        p_site_incharge_name: incharge || null,
        p_site_contact: contact || null,
        p_geocode_provider: loc!.provider,
      })
      if (error) throw error
      return data as CreatedSite
    },
    onSuccess: site => {
      toast.success(`${site.name} added to Expenses, Procurement and Attendance`)
      onCreated(site)
      reset()
      onOpenChange(false)
    },
    onError: (err: Error) => toast.error(err.message, { duration: 10000 }),
  })

  const d = 0.004
  const mapSrc = loc
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${loc.lng - d},${loc.lat - d},${loc.lng + d},${loc.lat + d}&layer=mapnik&marker=${loc.lat},${loc.lng}`
    : null

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) reset(); onOpenChange(o) }}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add new site</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-stone-500 -mt-2">
          Added to <b>Expenses &amp; Imprest</b>, <b>Procurement (CPS)</b> and <b>Attendance</b> in one go.
        </p>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Site name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Daxin - Signature Global" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label>Address *</Label>
              <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Sohna Toll, Gurugram–Sohna Road" />
            </div>
            <div className="space-y-1.5">
              <Label>Pincode</Label>
              <Input value={pincode} inputMode="numeric" maxLength={6} onChange={e => setPincode(e.target.value.replace(/\D/g, ''))} placeholder="122103" />
            </div>
          </div>

          <div className="rounded-lg border border-stone-200 p-3 space-y-2">
            <Label>Site location * <span className="font-normal text-stone-400">(attendance checks phones against this)</span></Label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={useMyLocation} disabled={busy !== null}>
                <LocateFixed size={14} className="mr-1" /> {busy === 'gps' ? 'Locating…' : "I'm at the site"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={findFromAddress} disabled={busy !== null}>
                <Search size={14} className="mr-1" /> {busy === 'search' ? 'Searching…' : 'Find from address'}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Link2 size={14} className="text-stone-400 shrink-0" />
              <Input value={mapsText} onChange={e => applyMapsText(e.target.value)} className="text-xs" placeholder="…or paste Google Maps link / 28.3226, 77.0579" />
            </div>
            {mapsText && !parseLatLng(mapsText) && (
              <p className="text-xs text-amber-700">Couldn't read coordinates. In Google Maps, long-press the site, then copy the numbers shown (e.g. 28.3226, 77.0579). Short maps.app.goo.gl links don't contain them.</p>
            )}
            {loc && (
              <>
                <p className="text-xs text-stone-500">{loc.label} — {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}</p>
                {mapSrc && <iframe title="Site map" src={mapSrc} className="w-full h-44 rounded border border-stone-200" loading="lazy" />}
              </>
            )}
            <div className="space-y-1.5 pt-1">
              <Label className="text-xs">Attendance radius</Label>
              <div className="flex flex-wrap gap-2">
                {RADIUS_OPTS.map(([v, l]) => (
                  <button type="button" key={v} onClick={() => setRadius(v)}
                    className={`px-3 py-1.5 rounded-full text-xs border ${radius === v ? 'bg-amber-700 text-white border-amber-700' : 'bg-white text-stone-600 border-stone-300'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Site in-charge</Label>
              <Input value={incharge} onChange={e => setIncharge(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Site contact</Label>
              <Input value={contact} onChange={e => setContact(e.target.value)} />
            </div>
          </div>

          <div className={`rounded-lg border p-3 ${blocking ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
            <ul className="space-y-1 text-xs">
              {checks.map((c, i) => (
                <li key={i} className={`flex gap-2 ${!c.ok ? 'text-red-600 font-medium' : c.warn ? 'text-amber-700' : 'text-stone-600'}`}>
                  {!c.ok ? <Circle size={14} className="shrink-0" />
                    : c.warn ? <AlertTriangle size={14} className="shrink-0" />
                    : <CheckCircle size={14} className="text-emerald-500 shrink-0" />}
                  {c.text}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-amber-800 hover:bg-amber-700" disabled={blocking > 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Adding…' : 'Add site everywhere'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
