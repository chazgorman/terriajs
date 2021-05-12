import i18next from "i18next";
import { computed } from "mobx";
import filterOutUndefined from "../../Core/filterOutUndefined";
import isDefined from "../../Core/isDefined";
import TerriaError from "../../Core/TerriaError";
import { ShortReportTraits } from "../../Traits/CatalogMemberTraits";
import { FeatureInfoTemplateTraits } from "../../Traits/FeatureInfoTraits";
import LegendTraits from "../../Traits/LegendTraits";
import SdmxCatalogItemTraits, {
  SdmxDimensionTraits
} from "../../Traits/SdmxCatalogItemTraits";
import {
  ModelOverrideTraits,
  ModelOverrideType
} from "../../Traits/SdmxCommonTraits";
import TableChartStyleTraits, {
  TableChartLineStyleTraits
} from "../../Traits/TableChartStyleTraits";
import TableColorStyleTraits from "../../Traits/TableColorStyleTraits";
import TableColumnTraits, {
  ColumnTransformationTraits
} from "../../Traits/TableColumnTraits";
import TableStyleTraits from "../../Traits/TableStyleTraits";
import TableTimeStyleTraits from "../../Traits/TableTimeStyleTraits";
import createCombinedModel from "../createCombinedModel";
import createStratumInstance from "../createStratumInstance";
import LoadableStratum from "../LoadableStratum";
import Model, { BaseModel } from "../Model";
import proxyCatalogItemUrl from "../proxyCatalogItemUrl";
import StratumFromTraits from "../StratumFromTraits";
import StratumOrder from "../StratumOrder";
import SdmxJsonCatalogItem from "./SdmxJsonCatalogItem";
import { loadSdmxJsonStructure, parseSdmxUrn } from "./SdmxJsonServerStratum";
import {
  Attribute,
  CodeLists,
  ConceptSchemes,
  ContentConstraints,
  Dataflow,
  DataStructure,
  Dimension,
  SdmxJsonStructureMessage
} from "./SdmxJsonStructureMessage";

export interface SdmxJsonDataflow {
  /** metadata for dataflow (eg description) */
  dataflow: Dataflow;
  /** lists this dataflow's dimensions (including time), attributes, primary measure, ... */
  dataStructure: DataStructure;
  /** codelists describe dimension/attribute values (usually to make them human-readable) */
  codelists?: CodeLists;
  /** concept schemes: used to describe dimensions and attributes */
  conceptSchemes?: ConceptSchemes;
  /** contentConstraints: describe allowed values for enumeratted dimensions/attributes */
  contentConstraints?: ContentConstraints;
}
export class SdmxJsonDataflowStratum extends LoadableStratum(
  SdmxCatalogItemTraits
) {
  static stratumName = "sdmxJsonDataflow";

  duplicateLoadableStratum(model: BaseModel): this {
    return new SdmxJsonDataflowStratum(
      model as SdmxJsonCatalogItem,
      this.sdmxJsonDataflow
    ) as this;
  }

  /**
   * Load SDMX-JSON dataflow - will also load references (dataStructure, codelists, conceptSchemes, contentConstraints)
   */
  static async load(
    catalogItem: SdmxJsonCatalogItem
  ): Promise<SdmxJsonDataflowStratum> {
    // Load dataflow (+ all related references)
    let dataflowStructure: SdmxJsonStructureMessage = await loadSdmxJsonStructure(
      proxyCatalogItemUrl(
        catalogItem,
        `${catalogItem.baseUrl}/dataflow/${catalogItem.agencyId}/${catalogItem.dataflowId}?references=all`
      ),
      false
    );

    // Check response
    if (!isDefined(dataflowStructure.data)) {
      throw new TerriaError({
        title: i18next.t("models.sdmxJsonDataflowStratum.loadDataErrorTitle"),
        message: i18next.t(
          "models.sdmxJsonDataflowStratum.loadDataErrorMessage.invalidResponse"
        )
      });
    }
    if (
      !Array.isArray(dataflowStructure.data.dataflows) ||
      dataflowStructure.data.dataflows.length === 0
    ) {
      throw new TerriaError({
        title: i18next.t("models.sdmxJsonDataflowStratum.loadDataErrorTitle"),
        message: i18next.t(
          "models.sdmxJsonDataflowStratum.loadDataErrorMessage.noDataflow",
          this
        )
      });
    }
    if (
      !Array.isArray(dataflowStructure.data.dataStructures) ||
      dataflowStructure.data.dataStructures.length === 0
    ) {
      throw new TerriaError({
        title: i18next.t("models.sdmxJsonDataflowStratum.loadDataErrorTitle"),
        message: i18next.t(
          "models.sdmxJsonDataflowStratum.loadDataErrorMessage.noDatastructure",
          this
        )
      });
    }

    return new SdmxJsonDataflowStratum(catalogItem, {
      dataflow: dataflowStructure.data.dataflows[0],
      dataStructure: dataflowStructure.data.dataStructures[0],
      codelists: dataflowStructure.data.codelists,
      conceptSchemes: dataflowStructure.data.conceptSchemes,
      contentConstraints: dataflowStructure.data.contentConstraints
    });
  }

  constructor(
    private readonly catalogItem: SdmxJsonCatalogItem,
    private readonly sdmxJsonDataflow: SdmxJsonDataflow
  ) {
    super();
  }

  @computed
  get description() {
    return this.sdmxJsonDataflow.dataflow.description;
  }

  get sdmxAttributes() {
    return (
      this.sdmxJsonDataflow.dataStructure.dataStructureComponents?.attributeList
        ?.attributes ?? []
    );
  }

  get sdmxDimensions() {
    return (
      this.sdmxJsonDataflow.dataStructure.dataStructureComponents?.dimensionList
        ?.dimensions ?? []
    );
  }

  get sdmxTimeDimensions() {
    return (
      this.sdmxJsonDataflow.dataStructure.dataStructureComponents?.dimensionList
        .timeDimensions ?? []
    );
  }

  get sdmxPrimaryMeasure() {
    return this.sdmxJsonDataflow.dataStructure.dataStructureComponents
      ?.measureList.primaryMeasure;
  }

  /**
   * If we get a dataflow with a single value (and not region-mapped), show the exact value in a short report
   */
  @computed
  get shortReportSections() {
    if (this.catalogItem.mapItems.length !== 0 || this.catalogItem.isLoading)
      return;

    const primaryCol = this.catalogItem.tableColumns.find(
      col => col.name === this.primaryMeasureColumn?.name
    );
    if (
      primaryCol?.valuesAsNumbers.values.length === 1 &&
      typeof primaryCol?.valuesAsNumbers.values[0] === "number"
    ) {
      return [
        createStratumInstance(ShortReportTraits, {
          name: this.unitMeasure,
          content: primaryCol?.valuesAsNumbers.values[0].toLocaleString(
            undefined,
            primaryCol.traits.format
          )
        })
      ];
    }
  }

  // ------------- START SDMX TRAITS STRATUM -------------

  /** Merge codelist and concept model overrides (codelist takes priority) */
  getMergedModelOverride(
    dim: Attribute | Dimension
  ): Model<ModelOverrideTraits> | undefined {
    const conceptOverride = this.catalogItem.modelOverrides.find(
      concept => concept.id === dim.conceptIdentity
    );
    const codelistOverride = this.catalogItem.modelOverrides.find(
      codelist => codelist.id === dim.localRepresentation?.enumeration
    );

    let modelOverride = conceptOverride;
    if (!modelOverride) {
      modelOverride = codelistOverride;

      // If there is a codelist and concept override, merge them
    } else if (codelistOverride) {
      modelOverride = createCombinedModel(codelistOverride, modelOverride);
    }

    return modelOverride;
  }
  /**
   * This maps SDMX-JSON dataflow structure to SdmxDimensionTraits - it uses:
   * - Data structure's dimensions (filtered to only include "enumerated" dimensions)
   * - Content constraints to find dimension options
   * - Codelists to add human readable labels to dimension options
   *
   * It will also apply ModelOverrides - which are used to override dimension values based on concept/codelist ID.
   * - @see ModelOverrideTraits
   */
  @computed
  get dimensions(): StratumFromTraits<SdmxDimensionTraits>[] | undefined {
    // Contraint contains allowed dimension values for a given dataflow
    // Get 'actual' constraints (rather than 'allowed' constraints)
    const constraints = this.sdmxJsonDataflow.contentConstraints?.filter(
      c => c.type === "Actual"
    );

    return (
      this.sdmxDimensions
        // Filter normal enum dimensions
        .filter(
          dim =>
            dim.id &&
            dim.type === "Dimension" &&
            dim.localRepresentation?.enumeration
        )
        .map(dim => {
          const modelOverride = this.getMergedModelOverride(dim);

          // Concept maps dimension's ID to a human-readable name
          const concept = this.getConceptByUrn(dim.conceptIdentity);

          // Codelist maps dimension enum values to human-readable labels
          const codelist = this.getCodelistByUrn(
            dim.localRepresentation?.enumeration
          );

          // Get allowed options from constraints.cubeRegions (there may be multiple - take union of all values)
          const allowedOptionIdsSet = Array.isArray(constraints)
            ? constraints.reduce<Set<string>>((keys, constraint) => {
                constraint.cubeRegions?.forEach(cubeRegion =>
                  cubeRegion.keyValues
                    ?.filter(kv => kv.id === dim.id)
                    ?.forEach(regionKey =>
                      regionKey.values?.forEach(value => keys.add(value))
                    )
                );
                return keys;
              }, new Set())
            : undefined;

          // Get unique allowed options from constraints.cubeRegions
          const allowedOptionIds = isDefined(allowedOptionIdsSet)
            ? Array.from(allowedOptionIdsSet)
            : [];

          // Get codes by merging allowedOptionIds with codelist
          let filteredCodesList =
            (allowedOptionIds.length > 0
              ? codelist?.codes?.filter(
                  code =>
                    allowedOptionIds && allowedOptionIds.includes(code.id!)
                )
              : // If no allowedOptions were found -> return all codes
                codelist?.codes) ?? [];

          // Create options object
          // If modelOverride `options` has been defined -> use it
          // Other wise use filteredCodesList
          const overrideOptions = modelOverride?.options;
          const options =
            isDefined(overrideOptions) && overrideOptions.length > 0
              ? overrideOptions.map(option => {
                  return { id: option.id, name: option.name };
                })
              : filteredCodesList.map(code => {
                  return { id: code.id!, name: code.name };
                });

          if (isDefined(options) && options.length > 0) {
            // Use first option as default if no other default is provided
            let selectedId: string | undefined = modelOverride?.allowUndefined
              ? undefined
              : options[0].id;

            // Override selectedId if it a valid option
            const selectedIdOverride = modelOverride?.selectedId;

            if (
              isDefined(selectedIdOverride) &&
              options.find(option => option.id === selectedIdOverride)
            ) {
              selectedId = selectedIdOverride;
            }

            return {
              id: dim.id!,
              name: modelOverride?.name ?? concept?.name,
              options: options,
              position: dim.position,
              disable: modelOverride?.disable,
              allowUndefined: modelOverride?.allowUndefined,
              selectedId: selectedId
            };
          }
        })
        .filter(isDefined)
    );
  }

  /**
   * Adds SDMX Common concepts as model overrides:
   * - `UNIT_MEASURE` (see `this.unitMeasure`)
   * - `UNIT_MULT` (see `this.primaryMeasureColumn`)
   * - `FREQ` (see `this.unitMeasure`)
   */
  @computed
  get modelOverrides() {
    return filterOutUndefined(
      // Map through all dimensions and attributes to find ones which use common concepts
      [...this.sdmxDimensions, ...this.sdmxAttributes].map(dimAttr => {
        const conceptUrn = parseSdmxUrn(dimAttr.conceptIdentity);
        // Add UNIT_MEASURE common concept override for unit-measure
        if (conceptUrn?.descendantIds?.[0] === "UNIT_MEASURE") {
          return createStratumInstance(ModelOverrideTraits, {
            id: dimAttr.conceptIdentity,
            type: "unit-measure"
          });
          // Add UNIT_MULT common concept override for unit-multiplier
        } else if (conceptUrn?.descendantIds?.[0] === "UNIT_MULT") {
          return createStratumInstance(ModelOverrideTraits, {
            id: dimAttr.conceptIdentity,
            type: "unit-multiplier"
          });
          // Add FREQUENCY common concept override for frequency
        } else if (conceptUrn?.descendantIds?.[0] === "FREQ") {
          return createStratumInstance(ModelOverrideTraits, {
            id: dimAttr.conceptIdentity,
            type: "frequency"
          });
        }
      })
    );
  }

  /**
   * Get unitMeasure string using modelOverrides.
   * - Search for columns linked to dimensions/attributes which have modelOverrides of type "unit-measure"
   * - We will only use a column if it has a single unique value - as this unitMeasure it used effectively as "units" for the dataset
   * - Also search for dimensions which have modelOverrides of type "frequency".
   * - These will be used to add the frequency to the end of the unitMeasure string
   * For example: "Value (Yearly)" or "AUD (Quaterly)"
   *
   */
  @computed
  get unitMeasure(): string | undefined {
    // Find tableColumns which have corresponding modelOverride with type `unit-measure`
    // We will only use columns if they have a single unique value
    const unitMeasure = filterOutUndefined(
      this.catalogItem.modelOverrides
        ?.filter(override => override.type === "unit-measure" && override.id)
        .map(override => {
          // Find dimension/attribute id with concept or codelist override
          let dimOrAttr =
            this.getAttributionWithConceptOrCodelist(override.id!) ??
            this.getDimensionWithConceptOrCodelist(override.id!);

          const column = dimOrAttr?.id
            ? this.catalogItem.findColumnByName(dimOrAttr.id)
            : undefined;

          if (column?.uniqueValues.values.length === 1) {
            // If this column has a codelist, use it to format the value
            const codelist = this.getCodelistByUrn(
              dimOrAttr?.localRepresentation?.enumeration
            );

            const value = column?.uniqueValues.values[0];

            return codelist?.codes?.find(c => c.id === value)?.name ?? value;
          }
        })
    ).join(", ");

    // Find frequency from dimensions with modelOverrides of type "frequency".
    const frequencyDim = this.getDimensionsWithOverrideType(
      "frequency"
    ).find(dim => isDefined(dim.selectedId));

    // Try to get option label if it exists
    let frequency =
      frequencyDim?.options.find(o => o.id === frequencyDim.selectedId)?.name ??
      frequencyDim?.id;

    return `${unitMeasure}${frequency ? ` (${frequency})` : ""}`;
  }

  // ------------- START TABLE TRAITS STRATUM -------------

  /**
   * Add TableColumnTraits for primary measure column - this column contains observational values to be visualised on chart or map:
   * - `name` to dimension id
   * - `title` to concept name
   * - `transformation` if unit multiplier attribute has been found (which will apply `x*(10^unitMultiplier)` to all observation vlues)
   */
  @computed
  get primaryMeasureColumn(): StratumFromTraits<TableColumnTraits> | undefined {
    if (!this.sdmxPrimaryMeasure) return;

    const primaryMeasureConcept = this.getConceptByUrn(
      this.sdmxPrimaryMeasure?.conceptIdentity
    );

    // Find unit multipler columns by searching for attributes/dimensions which have modelOverrides of type "unit-multiplier".
    // Use the first column found
    const unitMultiplier = filterOutUndefined(
      this.catalogItem.modelOverrides
        ?.filter(override => override.type === "unit-multiplier" && override.id)
        .map(override => {
          // Find dimension/attribute id with concept or codelist
          let dimOrAttr =
            this.getAttributionWithConceptOrCodelist(override.id!) ??
            this.getDimensionWithConceptOrCodelist(override.id!);

          return dimOrAttr?.id;
        })
    )[0];

    return createStratumInstance(TableColumnTraits, {
      name: this.sdmxPrimaryMeasure?.id,
      title: primaryMeasureConcept?.name,
      type: "scalar",
      // If a unitMultiplier was found, we add `x*(10^unitMultiplier)` transformation
      transformation: unitMultiplier
        ? createStratumInstance(ColumnTransformationTraits, {
            expression: `x*(10^${unitMultiplier})`,
            dependencies: [unitMultiplier]
          })
        : undefined
    });
  }

  /**
   * Add TableColumnTraits for dimensions
   * The main purpose of this is to try to find the region type for columns.
   * It also adds:
   * - `name` as dimension id
   * - `title` as concept name (more human-readable than dimension id)
   * - `type` to `region` if a valid region-type is found, or `hidden` if the dimension is disabled
   */

  @computed
  get dimensionColumns(): StratumFromTraits<TableColumnTraits>[] {
    // Get columns for all dimensions (excluding time dimensions)
    return (
      this.sdmxDimensions

        .filter(dim => isDefined(dim.id))
        .map(dim => {
          // Hide dimension columns if they are disabled
          if (this.dimensions?.find(d => d.id === dim.id)?.disable) {
            return createStratumInstance(TableColumnTraits, {
              name: dim.id,
              type: "hidden"
            });
          }

          // Get concept for the current dimension
          const concept = this.getConceptByUrn(dim.conceptIdentity);
          // Get codelist for current dimension
          const codelist = this.getCodelistByUrn(
            dim.localRepresentation?.enumeration
          );

          const modelOverride = this.getMergedModelOverride(dim);

          // Try to find region type
          let regionType: string | undefined;

          // Are any regionTypes present in modelOverride
          regionType = this.matchRegionType(modelOverride?.regionType);

          // Next try fetching reigon type from another dimension (only if this modelOverride type 'region')
          // It will look through dimensions which have modelOverrides of type `region-type` and have a selectedId, if one is found - it will be used as the regionType of this column
          if (!isDefined(regionType) && modelOverride?.type === "region") {
            // Use selectedId of first dimension with one
            regionType = this.matchRegionType(
              this.getDimensionsWithOverrideType("region-type").find(d =>
                isDefined(d.selectedId)
              )?.selectedId
            );
          }

          // Try to find valid region type from:
          // - dimension ID
          // - codelist name
          // - codelist ID
          // - concept name?
          // - concept id (the string, not the full URN)

          if (!isDefined(regionType))
            regionType =
              this.matchRegionType(dim.id) ??
              this.matchRegionType(codelist?.name) ??
              this.matchRegionType(codelist?.id) ??
              this.matchRegionType(concept?.name) ??
              this.matchRegionType(concept?.id);

          // Apply regionTypeReplacements (which can replace regionType with a different regionType - using [{find:string, replace:string}] pattern)
          if (modelOverride?.type === "region") {
            const replacement = modelOverride?.regionTypeReplacements?.find(
              r => r.find === regionType
            )?.replace;
            if (isDefined(replacement)) {
              regionType = replacement;
            }
          }

          return createStratumInstance(TableColumnTraits, {
            name: dim.id,
            title: concept?.name,
            type: isDefined(regionType) ? "region" : "hidden",
            regionType
          });
        }) ?? []
    );
  }

  /**
   * Add traits for time columns:
   * - `name` to dimension id
   * - `type = time`
   * - `title` to concept name (if it exists)
   */
  @computed
  get timeColumns(): StratumFromTraits<TableColumnTraits>[] {
    return (
      this.sdmxTimeDimensions.map(dim => {
        const concept = this.getConceptByUrn(dim.conceptIdentity);
        return createStratumInstance(TableColumnTraits, {
          name: dim.id,
          title: concept?.name ?? dim.id,
          type: "time"
        });
      }) ?? []
    );
  }

  /**
   * Add traits for attribute columns - all attribute columns are hidden, they are used to describe the primary measure (in feature info, unit measure, unit multiplier...):
   * - `name` to attribute id
   * - `type = hidden`
   */
  @computed
  get attributeColumns(): StratumFromTraits<TableColumnTraits>[] {
    return (
      this.sdmxAttributes.map(attr => {
        return createStratumInstance(TableColumnTraits, {
          name: attr.id,
          type: "hidden"
        });
      }) ?? []
    );
  }

  /**
   * Munge all columns together
   */
  @computed
  get columns() {
    return filterOutUndefined([
      this.primaryMeasureColumn,
      ...this.dimensionColumns,
      ...this.timeColumns,
      ...this.attributeColumns
    ]);
  }

  /**
   * Set TableStyleTraits for primary measure column:
   * - Legend title is set to `unitMeasure` to add context - eg "AUD (Quaterly)"
   * - Chart traits are set if this dataflow is time-series with no region-mapping:
   *   - `xAxisColumn` to time column name
   *   - `lines.name` set to `unitMeasure`
   *   - `lines.yAxisColumn` set to primary measure column
   * - `regionColumn` set to region dimension name (if one exists)
   */
  @computed
  get styles() {
    if (this.primaryMeasureColumn) {
      return [
        createStratumInstance(TableStyleTraits, {
          id: this.primaryMeasureColumn.name,

          color: createStratumInstance(TableColorStyleTraits, {
            legend: createStratumInstance(LegendTraits, {
              title: this.unitMeasure
            })
          }),
          time: createStratumInstance(TableTimeStyleTraits, {
            timeColumn: this.timeColumns[0].name
          }),
          // Add chart if there is a time column but no region column
          chart:
            this.timeColumns.length > 0 &&
            !this.dimensionColumns.find(col => col.type === "region")
              ? createStratumInstance(TableChartStyleTraits, {
                  xAxisColumn: this.timeColumns[0].name,
                  lines: [
                    createStratumInstance(TableChartLineStyleTraits, {
                      name: this.unitMeasure,
                      yAxisColumn: this.primaryMeasureColumn.name
                    })
                  ]
                })
              : undefined,
          regionColumn: this.dimensionColumns.find(col => col.type === "region")
            ?.name
        })
      ];
    }
    return [];
  }

  /**
   * Set active table style to primary measure column
   */
  @computed
  get activeStyle() {
    return this.primaryMeasureColumn?.name;
  }

  /**
   * Formats feature info table to add:
   * - Current time (if time-series)
   * - Selected region (if region-mapped)
   * - All dimension values
   * - Formatted primary measure (the actual value)
   * - Time-series chart
   */
  @computed
  get featureInfoTemplate() {
    const regionType = this.catalogItem.activeTableStyle.regionColumn
      ?.regionType;
    if (!regionType) return;

    let template = '<table class="cesium-infoBox-defaultTable">';

    // Function to format row with title and value
    const row = (title: string, value: string) =>
      `<tr><td style="vertical-align: middle">${title}</td><td>${value}</td></tr>`;

    // Get time dimension values
    template += this.timeColumns
      ?.map(col => row(col.title ?? "Time", `{{${col.name}}}`))
      .join(", ");

    // Get region dimension values

    template += row(regionType?.description, `{{${regionType?.nameProp}}}`);

    // Get other dimension values
    template += this.catalogItem.sdmxSelectableDimensions
      ?.filter(d => (d.name || d.id) && !d.disable && d.selectedId)
      .map(d => {
        const selectedOption = d.options?.find(o => o.id === d.selectedId);
        return row((d.name || d.id)!, selectedOption?.name ?? d.selectedId!);
      })
      .join("");

    const primaryMeasureName =
      this.unitMeasure ??
      this.primaryMeasureColumn?.title ??
      this.primaryMeasureColumn?.name ??
      "Value";

    template +=
      row("", "") +
      row(
        primaryMeasureName,
        `{{#terria.formatNumber}}{useGrouping: true}{{${this.primaryMeasureColumn?.name}}}{{/terria.formatNumber}}`
      );

    // Add timeSeries chart if more than one time observation
    if (
      this.catalogItem.discreteTimes &&
      this.catalogItem.discreteTimes.length > 1
    ) {
      const chartName = `${this.catalogItem.name}: {{${regionType.nameProp}}}`;
      template += `</table><chart sources="${chartName}" title="${chartName}" x-column="{{terria.timeSeries.xName}}" y-column="${this.unitMeasure}" >{{terria.timeSeries.data}}</chart>`;
    }

    return createStratumInstance(FeatureInfoTemplateTraits, { template });
  }

  // ------------- START SDMX STRUCTURE HELPER FUNCTIONS -------------
  getConceptScheme(id: string) {
    if (!isDefined(id)) return;
    return this.sdmxJsonDataflow.conceptSchemes?.find(c => c.id === id);
  }

  getConceptByUrn(urn?: string) {
    if (!urn) return;
    const conceptUrn = parseSdmxUrn(urn);
    const conceptSchemeId = conceptUrn?.resourceId;
    const conceptId = conceptUrn?.descendantIds?.[0];

    if (!isDefined(conceptId)) return;
    let resolvedConceptScheme =
      typeof conceptSchemeId === "string"
        ? this.getConceptScheme(conceptSchemeId)
        : conceptSchemeId;

    return resolvedConceptScheme?.concepts?.find(d => d.id === conceptId);
  }

  getCodelistByUrn(urn?: string) {
    if (!urn) return;
    const codelistUrn = parseSdmxUrn(urn);
    const id = codelistUrn?.resourceId;
    if (!isDefined(id)) return;
    return this.sdmxJsonDataflow.codelists?.find(c => c.id === id);
  }

  /**
   * Find modelOverrides with type 'region-type' to try to extract regionType from another dimension
   * For example, ABS have a regionType dimension which may have values (SA1, SA2, ...), which could be used to determine regionType
   */
  getDimensionsWithOverrideType(type: ModelOverrideType) {
    return filterOutUndefined(
      this.catalogItem.modelOverrides
        ?.filter(override => override.type === type && override.id)
        .map(override => {
          // Find dimension id with concept or codelist
          return this.catalogItem.dimensions?.find(
            d =>
              d.id === this.getDimensionWithConceptOrCodelist(override.id!)?.id
          );
        })
    );
  }

  getDimensionWithConceptOrCodelist(id: string) {
    return this.sdmxDimensions.find(
      dim =>
        dim.conceptIdentity === id ||
        dim.localRepresentation?.enumeration === id
    );
  }

  getAttributionWithConceptOrCodelist(id: string) {
    return this.sdmxAttributes.find(
      attr =>
        attr.conceptIdentity === id ||
        attr.localRepresentation?.enumeration === id
    );
  }

  /**
   * Try to resolve `regionType` to a region provider (this will also match against region provider aliases)
   */
  matchRegionType(regionType?: string): string | undefined {
    if (!isDefined(regionType)) return;
    const matchingRegionProviders = this.catalogItem.regionProviderList?.getRegionDetails(
      [regionType],
      undefined,
      undefined
    );
    if (matchingRegionProviders && matchingRegionProviders.length > 0) {
      return matchingRegionProviders[0].regionProvider.regionType;
    }
  }
}

StratumOrder.addLoadStratum(SdmxJsonDataflowStratum.stratumName);
