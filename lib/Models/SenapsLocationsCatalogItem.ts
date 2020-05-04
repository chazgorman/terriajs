import i18next from "i18next";
import { computed, runInAction } from "mobx";
import URI from "urijs";

import isDefined from "../Core/isDefined";
import loadJson from "../Core/loadJson";
import TerriaError from "../Core/TerriaError";
import AsyncMappableMixin from "../ModelMixins/AsyncMappableMixin";
import CatalogMemberMixin from "../ModelMixins/CatalogMemberMixin";
import SenapsLocationsCatalogItemTraits from "../Traits/SenapsLocationsCatalogItemTraits";
import { FeatureInfoTemplateTraits } from "../Traits/FeatureInfoTraits";
import CreateModel from "./CreateModel";
import GeoJsonCatalogItem from "./GeoJsonCatalogItem";
import Terria from "./Terria";
import StratumOrder from "./StratumOrder";
import LoadableStratum from "./LoadableStratum";
import { BaseModel } from "./Model";
import { JsonObject } from "../Core/Json";
import proxyCatalogItemUrl from "./proxyCatalogItemUrl";
import createStratumInstance from "./createStratumInstance";

export interface SenapsFeature {
  type: string;
  properties: {
    id: string;
    description: string;
    endpoint: string;
    hasStreams: boolean | null;
    streamIds: string[];
  };
  geometry: JsonObject;
}

export interface SenapsFeatureCollection {
  type: string;
  features: SenapsFeature[];
}

interface SenapsStream {
  id: string;
}

interface SenapsStreamResponse {
  _embedded?: {
    streams: SenapsStream[];
  };
  count: number;
}

interface SenapsLocation {
  id: string;
  description: string;
  streamIds: string[];
  geojson: JsonObject;
  _links: {
    self: {
      href: string;
    };
  };
}

interface LocationsData {
  _embedded: {
    locations: SenapsLocation[];
  };
}

export class SenapsLocationsStratum extends LoadableStratum(
  SenapsLocationsCatalogItemTraits
) {
  static stratumName = "SenapsLocations";

  constructor(
    private readonly senapsLocationsCatalogItem: SenapsLocationsCatalogItem,
    private readonly geojsonItem: GeoJsonCatalogItem
  ) {
    super();
    this.geojsonItem = geojsonItem;
  }

  duplicateLoadableStratum(newModel: BaseModel): this {
    return new SenapsLocationsStratum(
      newModel as SenapsLocationsCatalogItem,
      this.geojsonItem
    ) as this;
  }

  static async load(senapsLocationsCatalogItem: SenapsLocationsCatalogItem) {
    const locationsUrl = senapsLocationsCatalogItem._constructLocationsUrl();
    try {
      const locationsResponse: LocationsData = await loadJson(
        proxyCatalogItemUrl(senapsLocationsCatalogItem, locationsUrl, "0d")
      );
      const locations = locationsResponse._embedded.locations;

      const streamPromises = [];
      for (var i = 0; i < locations.length; i++) {
        const location = locations[i];
        const locationId = location.id;
        const streamUrl = proxyCatalogItemUrl(
          senapsLocationsCatalogItem,
          senapsLocationsCatalogItem._constructStreamsUrl(locationId),
          "0d"
        );
        streamPromises.push(loadJson(streamUrl));
      }
      const streamData = await Promise.all(streamPromises);

      function addStreamIds(f: SenapsFeature, index: number) {
        const sd: SenapsStreamResponse = streamData[index];
        if (sd.count === 0) {
          f.properties.hasStreams = false;
        } else if (sd._embedded !== undefined) {
          f.properties.streamIds = sd._embedded.streams.map(
            (s: SenapsStream) => s.id
          );
          f.properties.hasStreams = true;
        }
      }

      const fc: SenapsFeatureCollection = {
        type: "FeatureCollection",
        features: locations.map((site: SenapsLocation, i: number) => {
          const f: SenapsFeature = {
            type: "Feature",
            properties: {
              id: site.id,
              description: site.description,
              endpoint: site._links.self.href,
              hasStreams: null,
              streamIds: []
            },
            geometry: site.geojson
          };
          addStreamIds(f, i);
          return f;
        })
      };

      const geojsonCatalogItem = new GeoJsonCatalogItem(
        undefined,
        senapsLocationsCatalogItem.terria
      );
      geojsonCatalogItem.setTrait(
        "definition",
        "geoJsonData",
        (fc as any) as JsonObject
      );

      geojsonCatalogItem.setTrait("definition", "clampToGround", true);

      if (isDefined(senapsLocationsCatalogItem.style)) {
        geojsonCatalogItem.setTrait(
          "definition",
          "style",
          senapsLocationsCatalogItem.style
        );
      }

      const featureInfo = createStratumInstance(FeatureInfoTemplateTraits, {
        template: `<h4>${i18next.t(
          "models.senaps.locationHeadingFeatureInfo"
        )}: {{id}}</h4>
  <h5 style="margin-bottom:5px;">${i18next.t(
    "models.senaps.availableStreamsHeadingFeatureInfo"
  )}</h5>
  {{#hasStreams}}
    <ul>{{#streamIds}}
      <li>{{.}}</li>
    {{/streamIds}}</ul>
    <br/>
    <chart
      id='{{id}}'
      title='{{id}}'
      sources='https://senaps.io/api/sensor/v2/observations?streamid={{#terria.urlEncodeComponent}}{{streamIds}}{{/terria.urlEncodeComponent}}&limit=1440&media=csv&csvheader=false&sort=descending,https://senaps.io/api/sensor/v2/observations?streamid={{#terria.urlEncodeComponent}}{{streamIds}}{{/terria.urlEncodeComponent}}&limit=7200&media=csv&csvheader=false&sort=descending'
      source-names='1d,5d'
      downloads='https://senaps.io/api/sensor/v2/observations?streamid={{#terria.urlEncodeComponent}}{{streamIds}}{{/terria.urlEncodeComponent}}&limit=1440&media=csv&csvheader=false&sort=descending,https://senaps.io/api/sensor/v2/observations?streamid={{#terria.urlEncodeComponent}}{{streamIds}}{{/terria.urlEncodeComponent}}&limit=7200&media=csv&csvheader=false&sort=descending'
      download-names='1d,5d'
    >
    </chart>
  {{/hasStreams}}
  {{^hasStreams}}
    <br/><br/>
  {{/hasStreams}}
  `
      });
      senapsLocationsCatalogItem.setTrait(
        "definition",
        "featureInfoTemplate",
        featureInfo
      );

      geojsonCatalogItem.loadMapItems();
      return new SenapsLocationsStratum(
        senapsLocationsCatalogItem,
        geojsonCatalogItem
      );
    } catch (e) {
      const msg =
        e.statusCode === 401
          ? "models.senaps.missingKeyErrorMessage"
          : "models.senaps.generalErrorMessage";
      throw new TerriaError({
        title: i18next.t("models.senaps.retrieveErrorTitle"),
        message: i18next.t(msg)
      });
    }
  }

  get dataSource(): GeoJsonCatalogItem {
    return this.geojsonItem;
  }
}

StratumOrder.addLoadStratum(SenapsLocationsStratum.stratumName);

class SenapsLocationsCatalogItem extends AsyncMappableMixin(
  CatalogMemberMixin(CreateModel(SenapsLocationsCatalogItemTraits))
) {
  static readonly type = "senaps-locations";

  readonly baseUrl = "https://senaps.io/api/sensor/v2";

  get type() {
    return SenapsLocationsCatalogItem.type;
  }

  get typeName() {
    return i18next.t("models.senaps.name");
  }

  readonly canZoomTo = true;

  protected forceLoadMapItems(): Promise<void> {
    return SenapsLocationsStratum.load(this).then(stratum => {
      if (stratum === undefined) return;
      runInAction(() => {
        this.strata.set(SenapsLocationsStratum.stratumName, stratum);
      });
    });
  }

  @computed get geoJsonItem() {
    const stratum = <SenapsLocationsStratum>(
      this.strata.get(SenapsLocationsStratum.stratumName)
    );
    return isDefined(stratum) ? stratum.dataSource : undefined;
  }

  @computed get mapItems() {
    if (isDefined(this.geoJsonItem)) {
      return this.geoJsonItem.mapItems.map(mapItem => {
        mapItem.show = this.show;
        return mapItem;
      });
    }
    return [];
  }

  protected forceLoadMetadata(): Promise<void> {
    return Promise.resolve();
  }

  _constructLocationsUrl() {
    var uri = new URI(`${this.baseUrl}/locations`);
    if (this.locationIdFilter !== undefined) {
      uri.setSearch("id", this.locationIdFilter);
    }
    uri.setSearch("count", "1000");
    uri.setSearch("expand", "true");
    return uri.toString();
  }

  _constructStreamsUrl(locationId: string) {
    var uri = new URI(`${this.baseUrl}/streams`);
    if (this.streamIdFilter !== undefined) {
      uri.setSearch("id", this.streamIdFilter);
    }
    uri.setSearch("locationid", locationId);
    return uri.toString();
  }
}

export default SenapsLocationsCatalogItem;