# SheetJS browser import

`xlsx.full.min.js` is SheetJS CE 0.20.3, downloaded from the official distribution:
https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js

SHA-256: `cc015130aa8521e7f088f88898eba949ccdccbfb38df0bd129b44b7273c3a6f41`.
The upstream license is retained in `xlsx.LICENSE`. The browser loads the local copy only when importing Excel; workbook contents are parsed locally.

`planner.js` in the web root is a packaging copy of `source/calendar/planner/planner.js`; the course import tests check equality. The existing line validation is reused by the course editor and renderer.
