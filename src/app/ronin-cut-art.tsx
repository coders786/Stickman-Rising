// Original two-tone ink cel. The blade, hand, shoulder and face are drawn as
// connected shapes. No raster asset, filter, moving mask or effect on the ink.
export function RoninCutArt() {
  return (
    <svg className="sr-ronin-ink" viewBox="0 0 640 288" aria-hidden="true" focusable="false">
      {/* Registration marks, moon and a suggestion of the Bridge's rail. */}
      <path d="M51 74V50h24m490 0h24v24M51 214v24h24m490 0h24v-24" fill="none" stroke="#494b50" strokeWidth="1.5" />
      <path d="M69 209H567M69 216h498" fill="none" stroke="#282b30" strokeWidth="1.5" />
      <path d="M98 209v14m59-14v14m328-14v14m59-14v14" stroke="#282b30" strokeWidth="2" />
      <circle cx="307" cy="136" r="89" fill="#c9c2ad" />
      <path d="M222 152h41m-31 8h47m68-31h49m-39 8h37m-150 58h137" stroke="#a29f94" strokeWidth="2" />
      <path d="M76 110h43m-43 6h17m437 64h35m-19-6h19" stroke="#494b50" strokeWidth="1.5" />
      {/* The rest of the pose is deliberately lost in the same matte as the cover. */}
      <path d="M181 259 194 232 228 203 250 172 273 153 320 160 340 183l26-18 12 12-22 31-36 15 24 36Z" fill="#0a0c0e" />
      <path d="m184 256 14-22 33-28 24-32 18-12 14 7-18 9-25 33-27 13-12 19Z" fill="#33373d" />
      <path d="m267 176 23-13 24-1 19 24 22-12-12 17-18 9-19-21-20 2-21 16Z" fill="#181c22" />
      <path d="M256 112c5-16 24-26 44-23 19 2 30 13 34 28l10 11-10 5-2 12-6 8-18 4-7 17-24-10 1-13c-18-7-30-20-22-39Z" fill="#0a0c0e" />
      <path d="M258 111c8-17 25-23 42-22 14 1 24 9 29 18-14-8-32-10-46-4l-23 12Z" fill="#33373d" />
      {/* A cloth band, with one angular fold trailing back in the wind. */}
      <path d="M254 116c23-7 55-12 79-5l2 6c-27-5-47 0-77 8l-9 2-18-6-24 5-27-3 28-8 25-2 18 4Z" fill="#943542" />
      <path d="m251 122-22 6-23 16-34 2 28-9 23-15 28-5Z" fill="#622c37" />
      <path d="m310 124 17-3-1 3-13 3Z" fill="#d5cbb2" />
      {/* Scabbard across the waist, then the exposed steel and closed hand. */}
      <path d="m144 268 10-10 154-59 10 11-158 62Z" fill="#22252a" />
      <path d="m154 260 154-59 4 3-154 60Z" fill="#5d5b59" />
      <path d="m307 199 54-37 9 11-51 42Z" fill="#17191d" stroke="#585552" strokeWidth="1.5" />
      <path d="m319 200 2 6m6-12 2 6m6-11 2 5m6-12 3 6m5-12 3 6" stroke="#943542" strokeWidth="2.5" />
      <path d="M371 160 521 66l22-7-14 16-149 97Z" fill="#a0444b" />
      <path d="M377 166 543 59l-14 16-149 97Z" fill="#e1d5bd" />
      <path d="m365 151 21 26-5 5-22-27Z" fill="#20242a" stroke="#74716a" strokeWidth="1.5" />
      <path d="m340 183 5-13 13-8 8 2 7 10-3 7-16 11Z" fill="#0a0c0e" />
      <path d="m343 179 4-8 11-7 6 1 3 4-9 1-11 8Z" fill="#55514e" />
      <path d="m256 229 9-15 12-4 12 7-3 7-13 2-8 8Z" fill="#0a0c0e" />
      <path d="m260 225 7-10 10-3 7 4-12 1-7 6Z" fill="#4a4b4b" />
    </svg>
  )
}
