"""Internal service: fetch one Funda listing via pyfunda and return it as plain JSON.

Only reachable from the app container (no published port). The app calls it once
per house we add, so volume stays at a handful of requests a week.

GET /listing?id=<funda url or id>  -> listing JSON
GET /health                        -> "ok"
"""

import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from funda import Funda
from funda.exceptions import ListingNotFound

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")


def floorplan(item):
    # EmbedUrl looks like https://fmlpub.s3-eu-west-1.amazonaws.com/embed.html?designId=1&projectId=2
    query = parse_qs(urlparse(item.embed_url or "").query)
    return {
        "name": item.display_name,
        "projectId": (query.get("projectId") or [None])[0],
        "designId": (query.get("designId") or [None])[0],
    }


def to_json(listing):
    a, p, ar, r, d, loc = (
        listing.address,
        listing.price,
        listing.areas,
        listing.rooms,
        listing.property_details,
        listing.location,
    )
    return {
        "url": listing.urls.full,
        "address": a.title,
        "postcode": a.postcode,
        "city": a.city,
        "neighbourhood": a.neighbourhood,
        "price": p.amount,
        "priceFormatted": p.formatted,
        "livingArea": ar.living,
        "plotArea": ar.plot,
        "volume": ar.volume,
        "rooms": r.total,
        "bedrooms": r.bedrooms,
        "bathrooms": r.bathrooms_description,
        "floors": r.floors_description,
        "yearBuilt": d.construction_year,
        "energyLabel": d.energy_label,
        "houseType": d.house_type,
        "status": d.raw_status,
        "highlight": listing.highlight,
        "description": listing.description,
        "publicationDate": listing.publication_date,
        "latitude": loc.latitude if loc else None,
        "longitude": loc.longitude if loc else None,
        "photos": [m.url for m in listing.media.photos if m.url],
        "floorplans": [floorplan(m) for m in listing.media.floorplans],
    }


class Handler(BaseHTTPRequestHandler):
    def send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/health":
            return self.send(200, "ok")
        if url.path != "/listing":
            return self.send(404, {"error": "not found"})
        listing_id = (parse_qs(url.query).get("id") or [""])[0].strip()
        if not listing_id:
            return self.send(400, {"error": "missing id"})
        try:
            with Funda() as client:
                listing = client.listing(listing_id)
            logging.info("fetched %s", listing_id)
            return self.send(200, to_json(listing))
        except ValueError as error:  # not a Funda URL or id
            return self.send(400, {"error": str(error)})
        except ListingNotFound:
            return self.send(404, {"error": "listing not found"})
        except Exception as error:  # Funda changed something, or blocked us
            logging.exception("fetch failed for %s", listing_id)
            return self.send(502, {"error": f"{type(error).__name__}: {error}"[:300]})

    def log_message(self, *args):
        pass  # we log fetches ourselves


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
