// ==UserScript==
// @name            WME CA Government Boundaries
// @namespace       https://greasyfork.org/users/45389
// @version         2026.03.01.00
// @description     Adds layers to display Canadian provincial, census division, census subdivision, designated place, and forward sortation area boundaries.
// @author          JS55CT
// @include         /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor\/?.*$/
// @require         https://cdn.jsdelivr.net/npm/@turf/turf@7/turf.min.js
// @require         https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @require         https://update.greasyfork.org/scripts/509664/WME%20Utils%20-%20Bootstrap.js
// @grant           GM_xmlhttpRequest
// @license         GNU GPLv3
// @contributionURL https://github.com/WazeDev/Thank-The-Authors
// @connect         geo.statcan.gc.ca
// @connect         greasyfork.org
// ==/UserScript==

//TO DUE BEFORE RELEASE.  Create Github Repo in WazeDev, Create greesyforce script page and tie it to WazeDev repo updates.  Add greesyforce update URL below and add back the scripupdatemanitor.

/**
 * @fileoverview WME CA Government Boundaries - A Waze Map Editor script for visualizing Canadian boundaries
 *
 * @description
 * This UserScript enhances the Waze Map Editor with interactive boundary visualizations for:
 * - Provinces & Territories
 * - Census Divisions (with full type name resolution)
 * - Census Subdivisions (with full type name resolution)
 * - Designated Places (with full type name resolution)
 * - Forward Sortation Areas (first 3 characters of Canadian postal codes)
 *
 * Data sourced from Statistics Canada 2021 Digital Boundary Files (ArcGIS REST API).
 *
 * @author JS55CT
 * @license GNU GPLv3
 */

/* global turf */
/* global WazeWrap */
/* global bootstrap */

(async function main() {
  'use strict';

  const UPDATE_MESSAGE = 'Initial Release';
  const downloadUrl = '';

  const SETTINGS_STORE_NAME = 'wme_ca_government_boundaries';

  const PROVINCES_LAYER_URL =
    'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Digital_boundary_files/MapServer/0/';
  const CENSUS_DIVISIONS_LAYER_URL =
    'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Digital_boundary_files/MapServer/4/';
  const CENSUS_SUBDIVISIONS_LAYER_URL =
    'https://geo.statcan.gc.ca/geo_wa/rest/services/2025/lcsd000a25s_e/MapServer/0/'; //https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Digital_boundary_files/MapServer/9/
  const DESIGNATED_PLACES_LAYER_URL =
    'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Digital_boundary_files/MapServer/8/';
  const FSA_LAYER_URL =
    'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/14/';

  /**
   * Calculates the maximum allowable offset (generalization) for boundary features based on zoom level.
   * Higher zoom levels require smaller offsets for more detailed rendering.
   *
   * @param {number} zoomLevel - Current map zoom level (typically 4-22)
   * @returns {number} Maximum allowable offset in degrees
   */
  function getMaxAllowableOffsetForZoom(zoomLevel) {
    const zoomToOffsetMap = {
      4: 0.057,
      5: 0.057,
      6: 0.057,
      7: 0.0285,
      8: 0.0142,
      9: 0.0072,
      10: 0.0036,
      11: 0.0018,
      12: 0.0009,
      13: 0.00045,
      14: 0.000225,
      15: 0.0001125,
      16: 0.000056,
      17: 0.000028,
      18: 0.000014,
      19: 0.000007,
      20: 0.000007,
      21: 0.000007,
      22: 0.000007,
    };
    const key = Math.round(zoomLevel);
    return zoomToOffsetMap[key] !== undefined ? zoomToOffsetMap[key] : zoomToOffsetMap[22];
  }

  const PROCESS_CONTEXTS = [];
  let _activeRequests = [];
  const sdk = await bootstrap({}); //, scriptUpdateMonitor: { downloadUrl }

  const PROVINCES_LAYER_NAME = "CA Gov't Boundaries - Provinces & Territories";
  const CENSUS_DIVISIONS_LAYER_NAME = "CA Gov't Boundaries - Census Divisions";
  const CENSUS_SUBDIVISIONS_LAYER_NAME = "CA Gov't Boundaries - Census Subdivisions";
  const DESIGNATED_PLACES_LAYER_NAME = "CA Gov't Boundaries - Designated Places";
  const FSA_LAYER_NAME = "CA Gov't Boundaries - FSA";

  const provincesCheckboxName = 'CAGB - Provinces';
  const censusDivisionsCheckboxName = 'CAGB - Census Divisions';
  const censusSubdivisionsCheckboxName = 'CAGB - Census Subdivisions';
  const designatedPlacesCheckboxName = 'CAGB - Designated Places';
  const fsaCheckboxName = 'CAGB - FSA';

  let _settings = {};
  let _fetchBoundariesTimeout;
  let _cachedScreenPolygon = null;
  let _cachedScreenArea = null;
  let _cachedExtent = null;
  let _cachedClipPolygon = null;

  // ============================================
  // LABEL TYPE MAPS
  // ============================================

  /**
   * Maps Statistics Canada Census Division type codes to full English/French names.
   * Used to build human-readable labels for census division boundaries.
   */
  const CDTYPE_MAP = {
    CD: 'Census Division / Division de recensement',
    CDR: 'Census Division Region',
    C: 'County / Comté',
    CC: 'County (municipalité de comté)',
    CM: 'County Municipality',
    CTY: 'County / Comté',
    CT: 'Community Territories',
    CU: 'United Counties',
    DM: 'District Municipality / Municipalité de district',
    D: 'District',
    DIS: 'District',
    DR: 'Division',
    DU: 'District Urban Municipality',
    MRC: 'Municipalité régionale de comté',
    MM: 'Metropolitan Municipality',
    RC: 'Regional County',
    REG: 'Region',
    RM: 'Regional Municipality / Municipalité régionale',
    RGM: 'Regional Municipality',
    T: 'Territory / Territoire',
    TER: 'Territory',
    UNI: 'Unité régionale / Regional unit',
    VR: 'Ville régionale / Regional city',
  };

  /**
   * Maps Statistics Canada Census Subdivision type codes to full names.
   * Used to build human-readable labels for census subdivision boundaries.
   */
  const CSDTYPE_MAP = {
    C: 'City / Cité',
    CC: 'Chartered community',
    CG: 'Community government',
    CN: 'Crown colony / Colonie de la couronne',
    CT: 'Canton (municipalité de)',
    CU: 'Cantons unis (municipalité de)',
    CV: 'City / Ville',
    CY: 'City',
    DM: 'District municipality',
    FD: 'Fire District',
    GR: 'Gouvernement régional',
    HAM: 'Hamlet',
    ID: 'Improvement district',
    IGD: 'Indian government district',
    IM: 'Island municipality',
    IRI: 'Indian reserve / Réserve indienne',
    LGD: 'Local government district',
    M: 'Municipality / Municipalité',
    MD: 'Municipal district',
    MRM: 'Regional Municipality / Municipalité Régional',
    'MÉ': 'Municipalité',
    MU: 'Municipality',
    NH: 'Northern hamlet',
    NL: "Nisga'a land",
    NO: 'Unorganized / Non organisé',
    NV: 'Northern village',
    P: 'Parish / Paroisse (municipalité de)',
    PE: 'Paroisse (municipalité de)',
    RCR: 'Rural community / Communauté rurale',
    RDA: 'Regional district electoral area',
    RGM: 'Regional municipality',
    RM: 'Rural municipality',
    RV: 'Resort village',
    RMU: 'Resort Municipality',
    'S-É': 'Indian settlement / Établissement indien',
    SA: 'Special area',
    SC: 'Subdivision of county municipality / Subdivision municipalité de comté',
    'SÉ': 'Settlement / Établissement',
    SET: 'Settlement',
    SG: 'Self-government / Autonomie gouvernementale',
    SM: 'Specialized municipality',
    SNO: 'Subdivision of unorganized / Subdivision non organisée',
    SV: 'Summer village',
    T: 'Town',
    TAL: "Tla'amin Lands",
    TC: 'Terres réservées aux Cris',
    TI: 'Terre inuite',
    TK: 'Terres réservées aux Naskapis',
    TL: 'Teslin land',
    TP: 'Township',
    TV: 'Town / Ville',
    TWL: 'Tsawwassen Lands',
    V: 'Ville',
    VC: 'Village cri',
    VK: 'Village naskapi',
    VL: 'Village',
    VN: 'Village nordique',
  };

  /**
   * Maps Statistics Canada Designated Place type codes to full names.
   * Used to build human-readable labels for designated place boundaries.
   */
  const DPLTYPE_MAP = {
    CFA: 'Class IV area',
    CS: 'Cluster subdivision',
    DMU: 'Dissolved municipality',
    DPL: 'Designated place',
    FLG: 'Former local government',
    IPL: 'Interim protected land',
    IRI: 'Indian reserve',
    IST: 'Island trust',
    LNC: 'Localité non constituée',
    LSB: 'Local service board',
    LSD: 'Local service district',
    LUD: 'Local urban district',
    MDI: 'Municipalité dissoute',
    MDP: 'Municipal defined places',
    MET: 'Métis settlement',
    NCM: 'Northern community',
    NS: 'Northern settlement',
    NVL: "Nisga'a village",
    OHM: 'Organized hamlet',
    RPC: 'Retired population centre',
    RS: 'Resort subdivision',
    SE: 'Aboriginal settlement',
    UNP: 'Unincorporated place',
    UUC: 'Unincorporated urban centre',
  };

  /**
   * Builds a human-readable label for a Census Division feature.
   * Combines the division name with the resolved full type name.
   *
   * @param {Object} attrs - ArcGIS feature attributes containing CDNAME and CDTYPE
   * @returns {string} Label in format "Name | Full Type Name"
   */
  function getCDLabel(attrs) {
    let label = '';
    if (attrs.CDNAME) {
      label += attrs.CDNAME.trim();
    }
    if (attrs.CDTYPE) {
      const typeCode = attrs.CDTYPE.trim().toUpperCase();
      const typeName = CDTYPE_MAP[typeCode] || typeCode;
      if (typeName) {
        if (label !== '') label += ' | ';
        label += typeName;
      }
    }
    return label;
  }

  /**
   * Builds a human-readable label for a Census Subdivision feature.
   * Combines the subdivision name with the resolved full type name.
   *
   * @param {Object} attrs - ArcGIS feature attributes containing CSDNAME and CSDTYPE
   * @returns {string} Label in format "Name | Full Type Name"
   */
  function getCSDLabel(attrs) {
    let label = '';
    if (attrs.CSDNAME) {
      label += attrs.CSDNAME.trim();
    }
    if (attrs.CSDTYPE) {
      const typeCode = attrs.CSDTYPE.trim().toUpperCase();
      const typeName = CSDTYPE_MAP[typeCode] || typeCode;
      if (typeName) {
        if (label !== '') label += ' | ';
        label += typeName;
      }
    }
    return label;
  }

  /**
   * Builds a human-readable label for a Designated Place feature.
   * Combines the place name with the resolved full type name.
   *
   * @param {Object} attrs - ArcGIS feature attributes containing DPLNAME and DPLTYPE
   * @returns {string} Label in format "Name | Full Type Name"
   */
  function getDPLLabel(attrs) {
    let label = '';
    if (attrs.DPLNAME) {
      label += attrs.DPLNAME.trim();
    }
    if (attrs.DPLTYPE) {
      const typeCode = attrs.DPLTYPE.trim().toUpperCase();
      const typeName = DPLTYPE_MAP[typeCode] || typeCode;
      if (typeName) {
        if (label !== '') label += ' | ';
        label += typeName;
      }
    }
    return label;
  }

  // ============================================
  // LOGGING
  // ============================================

  function log(message) {
    console.log('CAGB:', message);
  }

  function logDebug(message) {
    console.log('CAGB:', message);
  }

  function logError(message) {
    console.error('CAGB:', message);
  }

  // ============================================
  // SETTINGS
  // ============================================

  /**
   * Returns the default settings object for the script.
   *
   * @returns {Object} Default settings
   */
  function getDefaultSettings() {
    return {
      lastVersion: GM_info.script.version,
      layers: {
        provinces: {
          visible: true,
          dynamicLabels: true,
          color: '#0000ff',
          labelOutlineColor: '#add8e6',
          opacity: 0.6,
        },
        censusDivisions: {
          visible: true,
          dynamicLabels: true,
          color: '#ff8c69',
          labelOutlineColor: '#000000',
          opacity: 0.6,
          minZoom: 8,
        },
        censusSubdivisions: {
          visible: true,
          dynamicLabels: true,
          color: '#00aa44',
          labelOutlineColor: '#ffffff',
          opacity: 0.6,
          minZoom: 10,
        },
        designatedPlaces: {
          visible: true,
          dynamicLabels: true,
          color: '#9400d3',
          labelOutlineColor: '#ffffff',
          opacity: 0.6,
          minZoom: 11,
        },
        fsa: {
          visible: true,
          dynamicLabels: true,
          color: '#ff0000',
          labelOutlineColor: '#ffffff',
          opacity: 0.6,
          minZoom: 11,
        },
      },
      shortcuts: {
        'cagb-toggle-provinces': { raw: null, combo: null },
        'cagb-toggle-census-divisions': { raw: null, combo: null },
        'cagb-toggle-census-subdivisions': { raw: null, combo: null },
        'cagb-toggle-designated-places': { raw: null, combo: null },
        'cagb-toggle-fsa': { raw: null, combo: null },
      },
    };
  }

  /**
   * Recursively ensures all default settings properties exist in the loaded settings object.
   *
   * @param {Object} obj - Settings object to validate (modified in-place)
   * @param {Object} defaultObj - Default settings to use as template
   */
  function checkSettings(obj, defaultObj) {
    Object.keys(defaultObj).forEach((key) => {
      if (!obj.hasOwnProperty(key)) {
        obj[key] = defaultObj[key];
      } else if (defaultObj[key] && defaultObj[key].constructor === {}.constructor) {
        checkSettings(obj[key], defaultObj[key]);
      }
    });
  }

  /**
   * Loads user settings from localStorage and merges with defaults.
   */
  function loadSettings() {
    const loadedSettings = $.parseJSON(localStorage.getItem(SETTINGS_STORE_NAME));
    const defaultSettings = getDefaultSettings();
    if (loadedSettings) {
      _settings = loadedSettings;
      checkSettings(_settings, defaultSettings);
    } else {
      _settings = defaultSettings;
    }
  }

  /**
   * Persists current settings to localStorage.
   */
  function saveSettings() {
    if (localStorage) {
      localStorage.setItem(SETTINGS_STORE_NAME, JSON.stringify(_settings));
    }
  }

  // ============================================
  // POLYGON CACHING
  // ============================================

  /**
   * Ensures polygon caches are current for the active map extent.
   * Caches screen polygon, screen area, and clip polygon to avoid redundant calculations.
   *
   * @performance Prevents thousands of redundant turf.js calculations per hour
   */
  function ensurePolygonCaches() {
    const ext = sdk.Map.getMapExtent();

    if (
      _cachedExtent &&
      _cachedScreenPolygon &&
      _cachedScreenArea !== null &&
      _cachedClipPolygon &&
      _cachedExtent[0] === ext[0] &&
      _cachedExtent[1] === ext[1] &&
      _cachedExtent[2] === ext[2] &&
      _cachedExtent[3] === ext[3]
    ) {
      return;
    }

    _cachedExtent = ext;

    _cachedScreenPolygon = turf.polygon([
      [
        [ext[0], ext[3]],
        [ext[2], ext[3]],
        [ext[2], ext[1]],
        [ext[0], ext[1]],
        [ext[0], ext[3]],
      ],
    ]);

    _cachedScreenArea = turf.area(_cachedScreenPolygon);

    const width = ext[2] - ext[0];
    const height = ext[3] - ext[1];
    const expandBy = 2;
    const clipBox = [
      ext[0] - width * expandBy,
      ext[1] - height * expandBy,
      ext[2] + width * expandBy,
      ext[3] + height * expandBy,
    ];
    _cachedClipPolygon = turf.bboxPolygon(clipBox);
  }

  function getScreenPolygon() {
    ensurePolygonCaches();
    return _cachedScreenPolygon;
  }

  function getScreenArea() {
    ensurePolygonCaches();
    return _cachedScreenArea;
  }

  function getClipPolygon() {
    ensurePolygonCaches();
    return _cachedClipPolygon;
  }

  // ============================================
  // API URL BUILDER
  // ============================================

  /**
   * Constructs an ArcGIS REST API query URL for fetching boundary features within a map extent.
   *
   * @param {string} baseUrl - Base URL of the ArcGIS service layer (must end with '/')
   * @param {number[]} extent - Map extent as [minLon, minLat, maxLon, maxLat] (WGS84)
   * @param {number} zoom - Current map zoom level
   * @param {string[]} outFields - Array of field names to return
   * @param {string} [fParam='json'] - Response format
   * @returns {string} Complete ArcGIS query URL
   */
  function getUrl(baseUrl, extent, zoom, outFields, fParam = 'json') {
    const geometry = {
      xmin: extent[0],
      ymin: extent[1],
      xmax: extent[2],
      ymax: extent[3],
      spatialReference: { wkid: 4326 },
    };
    const geometryStr = encodeURIComponent(JSON.stringify(geometry));
    const maxAllowableOffsetDeg = getMaxAllowableOffsetForZoom(zoom);

    let url = `${baseUrl}query?geometry=${geometryStr}`;
    url += '&returnGeometry=true';
    url += `&outFields=${encodeURIComponent(outFields.join(','))}`;
    url += `&maxAllowableOffset=${maxAllowableOffsetDeg}`;
    url += '&spatialRel=esriSpatialRelIntersects';
    url += '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326';
    url += `&f=${fParam}`;

    console.log("URL", url);
    return url;
  }

  // ============================================
  // BOUNDARY NAME DISPLAY
  // ============================================

  let lastFsaFeatures = [];
  let lastDivisionFeatures = [];

  /**
   * Updates the boundary name display in the WME top bar based on the map center location.
   * Shows the FSA code and/or Census Division name that contains the map center point.
   *
   * @param {Object} context - Processing context to check for cancellation
   * @param {boolean} context.cancel - If true, display update is skipped
   */
  function updateNameDisplay(context) {
    const center = sdk.Map.getMapCenter();
    const mapCenter = turf.point([center.lon, center.lat]);

    if (context.cancel) return;

    if (_settings.layers.fsa.visible) {
      for (let i = 0; i < lastFsaFeatures.length; i++) {
        const feature = lastFsaFeatures[i];
        const bbox = turf.bbox(feature);
        if (
          center.lon < bbox[0] ||
          center.lon > bbox[2] ||
          center.lat < bbox[1] ||
          center.lat > bbox[3]
        ) {
          continue;
        }
        if (turf.booleanPointInPolygon(mapCenter, feature)) {
          const text = feature.properties.name;
          $('<span>', { id: 'cagb-fsa-text' })
            .css({ display: 'inline-block' })
            .text(text)
            .appendTo($('#cagb-fsa-boundary'));
        }
      }
    }

    if (_settings.layers.censusDivisions.visible) {
      for (let i = 0; i < lastDivisionFeatures.length; i++) {
        const feature = lastDivisionFeatures[i];
        const bbox = turf.bbox(feature);
        if (
          center.lon < bbox[0] ||
          center.lon > bbox[2] ||
          center.lat < bbox[1] ||
          center.lat > bbox[3]
        ) {
          continue;
        }
        if (turf.booleanPointInPolygon(mapCenter, feature)) {
          $('<span>', { id: 'cagb-division-text' })
            .css({ display: 'inline-block' })
            .text(feature.properties.name)
            .appendTo($('#cagb-division-boundary'));
        }
      }
    }
  }

  // ============================================
  // GEOMETRY PROCESSING
  // ============================================

  /**
   * Processes a boundary feature with complex geometry (potentially with holes/islands).
   * Handles ArcGIS ring-based geometries, clips to screen, and returns Turf.js polygons.
   *
   * @param {Object} boundary - ArcGIS feature with ring-based geometry
   * @param {Object} attributes - Properties to attach to resulting features
   * @returns {Object[]} Array of Turf.js polygon features, clipped and ready for rendering
   */
  function extractPolygonsWithExternalRings(boundary, attributes) {
    const coordinates = boundary.geometry.rings;
    const externalPolygons = [];
    const clipPolygon = getClipPolygon();

    let mainOuterPolygon = turf.polygon([coordinates[0]], attributes);
    mainOuterPolygon.id = 0;

    for (let i = 1; i < coordinates.length; i++) {
      const testPolygon = turf.polygon([coordinates[i]]);
      if (turf.booleanContains(mainOuterPolygon, testPolygon)) {
        const differenceResult = turf.difference(
          turf.featureCollection([mainOuterPolygon, testPolygon])
        );
        if (differenceResult) {
          mainOuterPolygon = differenceResult;
          mainOuterPolygon.id = 0;
        } else {
          mainOuterPolygon = null;
          break;
        }
      } else {
        testPolygon.properties = attributes;
        externalPolygons.push(testPolygon);
      }
    }

    const clippedPolygons = [];
    const polygonsToClip = mainOuterPolygon
      ? [mainOuterPolygon, ...externalPolygons]
      : externalPolygons;

    polygonsToClip.forEach((polygon) => {
      if (!polygon) return;

      const clippedFeature = turf.intersect(turf.featureCollection([polygon, clipPolygon]));
      if (clippedFeature) {
        switch (clippedFeature.geometry.type) {
          case 'Polygon':
            clippedPolygons.push(clippedFeature);
            break;
          case 'MultiPolygon':
            clippedFeature.geometry.coordinates.forEach((ring) =>
              clippedPolygons.push(turf.polygon(ring))
            );
            break;
          default:
            throw new Error('Unexpected feature type');
        }
      }
    });

    clippedPolygons
      .filter((polygon) => polygon.geometry.coordinates.length)
      .forEach((polygon) => {
        polygon.id = 0;
        polygon.properties = attributes;
      });

    return clippedPolygons;
  }

  /**
   * Generates optimally-positioned label points for a boundary feature.
   * Labels are placed at the visual center of mass of each significant visible section.
   * Sections smaller than 0.5% of the screen area are suppressed to prevent clutter.
   *
   * @param {Object} feature - Turf.js polygon feature
   * @returns {Object[]} Array of Turf.js point features for label rendering
   */
  function getLabelPoints(feature) {
    const screenPolygon = getScreenPolygon();
    const intersection = turf.intersect(turf.featureCollection([screenPolygon, feature]));
    const polygons = [];
    if (intersection) {
      switch (intersection.geometry.type) {
        case 'Polygon':
          polygons.push(intersection);
          break;
        case 'MultiPolygon':
          intersection.geometry.coordinates.forEach((ring) =>
            polygons.push(turf.polygon(ring))
          );
          break;
        default:
          throw new Error('Unexpected geometry type');
      }
    }

    const screenArea = getScreenArea();
    const points = polygons
      .filter((polygon) => {
        const polygonArea = turf.area(polygon);
        return polygonArea / screenArea > 0.005;
      })
      .map((polygon) => {
        let point = turf.centerOfMass(polygon);
        if (!turf.booleanPointInPolygon(point, polygon)) {
          point = turf.pointOnFeature(polygon);
        }
        point.properties = { type: 'label', label: feature.properties.name };
        point.id = 0;
        return point;
      });
    return points;
  }

  /**
   * Processes boundary features from the ArcGIS API response and renders them on the map.
   * This is the core processing function for all Canadian boundary types.
   *
   * @param {Object[]} boundaries - Array of ArcGIS feature objects
   * @param {Object} context - Processing context with cancel flag and callCount
   * @param {string} type - Boundary type: 'province', 'censusDivision', 'censusSubdivision',
   *                        'designatedPlace', or 'fsa'
   * @param {Function} getLabelFn - Function that receives feature attributes and returns label string
   */
  function processBoundaries(boundaries, context, type, getLabelFn) {
    let layerName;
    let layerSettings;

    switch (type) {
      case 'province':
        layerSettings = _settings.layers.provinces;
        layerName = PROVINCES_LAYER_NAME;
        break;
      case 'censusDivision':
        layerSettings = _settings.layers.censusDivisions;
        layerName = CENSUS_DIVISIONS_LAYER_NAME;
        break;
      case 'censusSubdivision':
        layerSettings = _settings.layers.censusSubdivisions;
        layerName = CENSUS_SUBDIVISIONS_LAYER_NAME;
        break;
      case 'designatedPlace':
        layerSettings = _settings.layers.designatedPlaces;
        layerName = DESIGNATED_PLACES_LAYER_NAME;
        break;
      case 'fsa':
        layerSettings = _settings.layers.fsa;
        layerName = FSA_LAYER_NAME;
        break;
      default:
        throw new Error('CAGB: Unexpected type argument in processBoundaries');
    }

    const allFeatures = [];

    if (context.cancel || !layerSettings.visible) {
      // do nothing
    } else {
      const screenArea = getScreenArea();
      sdk.Map.removeAllFeaturesFromLayer({ layerName });

      const allPolygons = [];
      const allLabels = [];

      if (!context.cancel) {
        try {
          boundaries.forEach((boundary) => {
            if (context.cancel) return;

            const labelText = getLabelFn(boundary.attributes);
            const attributes = {
              name: labelText,
              label: labelText,
              type,
            };

            const features = extractPolygonsWithExternalRings(boundary, attributes);
            if (features.length) {
              if (type === 'fsa' || type === 'censusDivision') {
                allFeatures.push(...features);
              }

              features.forEach((polygon) => {
                if (layerSettings.dynamicLabels) {
                  polygon.properties.label = '';
                } else {
                  const polygonArea = turf.area(polygon);
                  if (polygonArea / screenArea <= 0.005) {
                    polygon.properties.label = '';
                  }
                }
              });

              allPolygons.push(...features);

              if (layerSettings.dynamicLabels) {
                features.forEach((feature) => {
                  const labels = getLabelPoints(feature);
                  if (labels?.length) {
                    allLabels.push(...labels);
                  }
                });
              }
            }
          });
        } catch (e) {
          logError(`processBoundaries geometry error for ${type}: ${e.message}`);
        }

        if (allPolygons.length && !context.cancel) {
          try {
            sdk.Map.addFeaturesToLayer({ layerName, features: allPolygons });
          } catch (ex) {
            logError('FAIL adding polygons: ' + ex);
          }
        }

        if (allLabels.length && !context.cancel) {
          try {
            sdk.Map.addFeaturesToLayer({ layerName, features: allLabels });
          } catch (ex) {
            logError('FAIL adding labels: ' + ex);
          }
        }
      }
    }

    if (type === 'fsa') {
      lastFsaFeatures = allFeatures;
    } else if (type === 'censusDivision') {
      lastDivisionFeatures = allFeatures;
    }

    context.callCount--;
    if (context.callCount === 0) {
      updateNameDisplay(context);
      const idx = PROCESS_CONTEXTS.indexOf(context);
      if (idx > -1) {
        PROCESS_CONTEXTS.splice(idx, 1);
      }
    }
  }

  // ============================================
  // BOUNDARY FETCHING
  // ============================================

  /**
   * Fetches boundary features for all enabled layers from Statistics Canada ArcGIS services.
   * Uses GM_xmlhttpRequest instead of $.ajax to bypass CORS restrictions — StatCan's ArcGIS
   * services do not include Waze's origin in their CORS headers, which causes $.ajax to
   * silently fail with no response and no error message.
   *
   * Error cases (network error, API error, parse error) all call processBoundaries([], ...)
   * so that context.callCount is always decremented correctly.
   *
   * @performance Debounced by debouncedFetchBoundaries() to prevent excessive API calls
   */
  function fetchBoundaries() {
    if (PROCESS_CONTEXTS.length > 0) {
      PROCESS_CONTEXTS.forEach((ctx) => { ctx.cancel = true; });
    }

    _activeRequests.forEach((request) => {
      if (request && request.abort) request.abort();
    });
    _activeRequests = [];

    const extent = sdk.Map.getMapExtent();
    const zoom = sdk.Map.getZoomLevel();
    const context = { callCount: 0, cancel: false };
    PROCESS_CONTEXTS.push(context);

    $('.cagb-boundary-region').remove();
    $('.location-info-region').after(
      $('<div>', { id: 'cagb-division-boundary', class: 'cagb-boundary-region' }).css({
        color: 'white',
        float: 'left',
        marginLeft: '10px',
      }),
      $('<div>', { id: 'cagb-fsa-boundary', class: 'cagb-boundary-region' }).css({
        color: 'white',
        float: 'left',
        marginLeft: '10px',
      })
    );

    /**
     * Issues a single cross-domain request for one boundary layer via GM_xmlhttpRequest.
     * When zoom is below minZoom the layer is cleared immediately (no network request).
     *
     * @param {string} layerUrl - Base ArcGIS REST URL (must end with '/')
     * @param {string} type - Boundary type identifier
     * @param {string[]} outFields - Fields to include in the response
     * @param {Function} labelFn - Maps feature attributes to a display string
     * @param {number} [minZoom=0] - Minimum zoom level required to fetch this layer
     */
    function doFetch(layerUrl, type, outFields, labelFn, minZoom = 0) {
      if (zoom >= minZoom) {
        const url = getUrl(layerUrl, extent, zoom, outFields);
        context.callCount++;
        const request = GM_xmlhttpRequest({
          method: 'GET',
          url,
          onload(res) {
            try {
              const data = JSON.parse(res.responseText);
              if (data.error) {
                logError(`${type} layer API error: ${data.error.message}`);
                processBoundaries([], context, type, labelFn);
              } else {
                processBoundaries(data.features || [], context, type, labelFn);
              }
            } catch (e) {
              logError(`${type} layer parse/process error: ${e.message}`);
              processBoundaries([], context, type, labelFn);
            }
          },
          onerror(e) {
            logError(`${type} layer network error: ${e.error || 'unknown'}`);
            processBoundaries([], context, type, labelFn);
          },
        });
        _activeRequests.push(request);
      } else {
        processBoundaries([], context, type, labelFn);
      }
    }

    if (_settings.layers.provinces.visible) {
      doFetch(PROVINCES_LAYER_URL, 'province', ['PRNAME'], (attrs) => attrs.PRNAME || '');
    }
    if (_settings.layers.censusDivisions.visible) {
      doFetch(CENSUS_DIVISIONS_LAYER_URL, 'censusDivision', ['CDNAME', 'CDTYPE'], getCDLabel,
        _settings.layers.censusDivisions.minZoom);
    }
    if (_settings.layers.censusSubdivisions.visible) {
      doFetch(CENSUS_SUBDIVISIONS_LAYER_URL, 'censusSubdivision', ['CSDNAME', 'CSDTYPE'], getCSDLabel,
        _settings.layers.censusSubdivisions.minZoom);
    }
    if (_settings.layers.designatedPlaces.visible) {
      doFetch(DESIGNATED_PLACES_LAYER_URL, 'designatedPlace', ['DPLNAME', 'DPLTYPE'], getDPLLabel,
        _settings.layers.designatedPlaces.minZoom);
    }
    if (_settings.layers.fsa.visible) {
      doFetch(FSA_LAYER_URL, 'fsa', ['CFSAUID'], (attrs) => attrs.CFSAUID || '',
        _settings.layers.fsa.minZoom);
    }
  }

  // ============================================
  // EVENT HANDLERS
  // ============================================

  /**
   * Handles layer checkbox toggle events from the WME layer switcher.
   * Updates settings, layer visibility, syncs the modern UI toggle, and re-fetches boundaries.
   *
   * @param {Object} args - Event arguments from wme-layer-checkbox-toggled
   * @param {string} args.name - Checkbox name
   * @param {boolean} args.checked - New checked state
   */
  function onLayerCheckboxToggled(args) {
    let layerName;
    let settingsObj;
    let layerKey;

    switch (args.name) {
      case provincesCheckboxName:
        layerName = PROVINCES_LAYER_NAME;
        settingsObj = _settings.layers.provinces;
        layerKey = 'provinces';
        break;
      case censusDivisionsCheckboxName:
        layerName = CENSUS_DIVISIONS_LAYER_NAME;
        settingsObj = _settings.layers.censusDivisions;
        layerKey = 'censusDivisions';
        break;
      case censusSubdivisionsCheckboxName:
        layerName = CENSUS_SUBDIVISIONS_LAYER_NAME;
        settingsObj = _settings.layers.censusSubdivisions;
        layerKey = 'censusSubdivisions';
        break;
      case designatedPlacesCheckboxName:
        layerName = DESIGNATED_PLACES_LAYER_NAME;
        settingsObj = _settings.layers.designatedPlaces;
        layerKey = 'designatedPlaces';
        break;
      case fsaCheckboxName:
        layerName = FSA_LAYER_NAME;
        settingsObj = _settings.layers.fsa;
        layerKey = 'fsa';
        break;
      default:
        throw new Error('Unexpected layer switcher checkbox name.');
    }

    const visibility = args.checked;
    settingsObj.visible = visibility;
    saveSettings();
    sdk.Map.setLayerVisibility({ layerName, visibility });

    const layerCard = document.querySelector(`.cagb-layer-card[data-layer="${layerKey}"]`);
    if (layerCard) {
      const toggle = layerCard.querySelector('.cagb-visibility-toggle');
      if (toggle) {
        if (visibility) {
          toggle.classList.add('active');
        } else {
          toggle.classList.remove('active');
        }
      }
    }

    fetchBoundaries();
  }

  /**
   * Debounces boundary fetches to prevent excessive API calls during rapid panning.
   *
   * @param {number} [delay=250] - Delay in milliseconds
   */
  function debouncedFetchBoundaries(delay = 250) {
    clearTimeout(_fetchBoundariesTimeout);
    _fetchBoundariesTimeout = setTimeout(() => {
      fetchBoundaries();
    }, delay);
  }

  /**
   * Handles map movement end events. Triggers a debounced boundary fetch.
   */
  function onMapMoveEnd() {
    try {
      debouncedFetchBoundaries();
    } catch (e) {
      logError(e);
    }
  }

  // ============================================
  // LAYER INITIALIZATION
  // ============================================

  function showScriptInfoAlert() {
    WazeWrap.Interface.ShowScriptUpdate(
      GM_info.script.name,
      GM_info.script.version,
      UPDATE_MESSAGE,
      '',
      ''
    );
  }

  /**
   * Initializes the Provinces & Territories boundary layer.
   * Labels are hidden below zoom 5 and above zoom 21.
   */
  function initProvincesLayer() {
    sdk.Map.addLayer({
      layerName: PROVINCES_LAYER_NAME,
      styleContext: {
        getStrokeWidth: ({ zoomLevel }) => Math.round(1 + (zoomLevel - 4) * 0.29),
        getFontSize: ({ zoomLevel }) => `${Math.round(12 + (zoomLevel - 4) * 0.67)}px`,
        getLabelYOffset: ({ zoomLevel }) => {
          if (zoomLevel < 10) return 0;
          if (zoomLevel < 18) return 10;
          return 20;
        },
        getLabel: ({ feature, zoomLevel }) => {
          if (zoomLevel < 5) return '';
          if (zoomLevel > 21) return '';
          return feature?.properties?.label ?? '';
        },
        getStrokeColor: () => _settings.layers.provinces.color,
        getFontColor: () => _settings.layers.provinces.color,
        getLabelOutlineColor: () => _settings.layers.provinces.labelOutlineColor,
      },
      styleRules: [
        {
          predicate: (properties) => properties.type === 'label',
          style: {
            pointRadius: 0,
            fontSize: '${getFontSize}',
            fontFamily: 'Arial',
            fontWeight: 'bold',
            fontColor: '${getFontColor}',
            label: '${getLabel}',
            labelYOffset: '${getLabelYOffset}',
            labelOutlineColor: '${getLabelOutlineColor}',
            labelOutlineWidth: 2,
          },
        },
        {
          predicate: (properties) => properties.type === 'province',
          style: {
            strokeColor: '${getStrokeColor}',
            strokeOpacity: 1,
            strokeWidth: '${getStrokeWidth}',
            strokeDashstyle: 'solid',
            fillOpacity: 0,
          },
        },
      ],
    });
  }

  /**
   * Initializes the Census Divisions boundary layer.
   * At zoom ≤ 9, shortens labels by removing type suffixes.
   */
  function initCensusDivisionsLayer() {
    sdk.Map.addLayer({
      layerName: CENSUS_DIVISIONS_LAYER_NAME,
      styleContext: {
        getLabel: ({ feature, zoomLevel }) => {
          const rawLabel = feature?.properties?.label ?? '';
          // At low zoom, show only the name portion (before ' | ')
          if (zoomLevel <= 9) return rawLabel.split(' | ')[0];
          return rawLabel;
        },
        getFontSize: ({ zoomLevel }) => `${Math.round(14 + (zoomLevel - 4) * 0.5)}px`,
        getStrokeWidth: ({ zoomLevel }) => Math.round(2 + (zoomLevel - 4) * 0.33),
        getStrokeColor: () => _settings.layers.censusDivisions.color,
        getFontColor: () => _settings.layers.censusDivisions.color,
        getLabelOutlineColor: () => _settings.layers.censusDivisions.labelOutlineColor,
      },
      styleRules: [
        {
          style: {
            strokeColor: '${getStrokeColor}',
            strokeOpacity: 1,
            strokeWidth: '${getStrokeWidth}',
            strokeDashstyle: 'solid',
            fillOpacity: 0,
            pointRadius: 0,
            label: '${getLabel}',
            fontSize: '${getFontSize}',
            fontFamily: 'Arial',
            fontWeight: 'bold',
            fontColor: '${getFontColor}',
            labelOutlineColor: '${getLabelOutlineColor}',
            labelOutlineWidth: 2,
          },
        },
      ],
    });
  }

  /**
   * Initializes the Census Subdivisions boundary layer.
   * At low zoom, shows only the name portion without type suffix.
   */
  function initCensusSubdivisionsLayer() {
    sdk.Map.addLayer({
      layerName: CENSUS_SUBDIVISIONS_LAYER_NAME,
      styleContext: {
        getLabel: ({ feature, zoomLevel }) => {
          const rawLabel = feature?.properties?.label ?? '';
          if (zoomLevel <= 11) return rawLabel.split(' | ')[0];
          return rawLabel;
        },
        getFontSize: ({ zoomLevel }) => `${Math.round(11 + (zoomLevel - 4) * 0.4)}px`,
        getStrokeWidth: ({ zoomLevel }) => Math.round(1 + (zoomLevel - 4) * 0.25),
        getStrokeColor: () => _settings.layers.censusSubdivisions.color,
        getFontColor: () => _settings.layers.censusSubdivisions.color,
        getLabelOutlineColor: () => _settings.layers.censusSubdivisions.labelOutlineColor,
      },
      styleRules: [
        {
          style: {
            strokeColor: '${getStrokeColor}',
            strokeOpacity: 1,
            strokeWidth: '${getStrokeWidth}',
            strokeDashstyle: 'solid',
            fillOpacity: 0,
            pointRadius: 0,
            label: '${getLabel}',
            fontSize: '${getFontSize}',
            fontFamily: 'Arial',
            fontWeight: 'bold',
            fontColor: '${getFontColor}',
            labelOutlineColor: '${getLabelOutlineColor}',
            labelOutlineWidth: 2,
          },
        },
      ],
    });
  }

  /**
   * Initializes the Designated Places boundary layer.
   * Always shows full name + type suffix.
   */
  function initDesignatedPlacesLayer() {
    sdk.Map.addLayer({
      layerName: DESIGNATED_PLACES_LAYER_NAME,
      styleContext: {
        getLabel: ({ feature }) => feature?.properties?.label ?? '',
        getFontSize: ({ zoomLevel }) => `${Math.round(10 + (zoomLevel - 4) * 0.35)}px`,
        getStrokeWidth: ({ zoomLevel }) => Math.round(1 + (zoomLevel - 4) * 0.2),
        getStrokeColor: () => _settings.layers.designatedPlaces.color,
        getFontColor: () => _settings.layers.designatedPlaces.color,
        getLabelOutlineColor: () => _settings.layers.designatedPlaces.labelOutlineColor,
      },
      styleRules: [
        {
          style: {
            strokeColor: '${getStrokeColor}',
            strokeOpacity: 1,
            strokeWidth: '${getStrokeWidth}',
            strokeDashstyle: 'solid',
            fillOpacity: 0,
            pointRadius: 0,
            label: '${getLabel}',
            fontSize: '${getFontSize}',
            fontFamily: 'Arial',
            fontWeight: 'bold',
            fontColor: '${getFontColor}',
            labelOutlineColor: '${getLabelOutlineColor}',
            labelOutlineWidth: 2,
          },
        },
      ],
    });
  }

  /**
   * Initializes the Forward Sortation Area (FSA) boundary layer.
   * Labels are positioned above the boundary center.
   */
  function initFSALayer() {
    sdk.Map.addLayer({
      layerName: FSA_LAYER_NAME,
      styleContext: {
        getLabel: ({ feature }) => feature?.properties?.label ?? '',
        getStrokeWidth: ({ zoomLevel }) => Math.round(1 + (zoomLevel - 4) * 0.29),
        getFontSize: ({ zoomLevel }) => `${Math.round(12 + (zoomLevel - 4) * 0.67)}px`,
        getStrokeColor: () => _settings.layers.fsa.color,
        getFontColor: () => _settings.layers.fsa.color,
        getLabelOutlineColor: () => _settings.layers.fsa.labelOutlineColor,
      },
      styleRules: [
        {
          style: {
            pointRadius: 0,
            strokeColor: '${getStrokeColor}',
            strokeOpacity: 1,
            strokeWidth: '${getStrokeWidth}',
            strokeDashstyle: 'solid',
            fillOpacity: 0,
            fontSize: '${getFontSize}',
            fontFamily: 'Arial',
            fontWeight: 'bold',
            fontColor: '${getFontColor}',
            label: '${getLabel}',
            labelYOffset: -20,
            labelOutlineColor: '${getLabelOutlineColor}',
            labelOutlineWidth: 2,
          },
        },
      ],
    });
  }

  const LAYER_NAME_MAP = {
    provinces: PROVINCES_LAYER_NAME,
    censusDivisions: CENSUS_DIVISIONS_LAYER_NAME,
    censusSubdivisions: CENSUS_SUBDIVISIONS_LAYER_NAME,
    designatedPlaces: DESIGNATED_PLACES_LAYER_NAME,
    fsa: FSA_LAYER_NAME,
  };

  const LAYER_CHECKBOX_NAME_MAP = {
    provinces: provincesCheckboxName,
    censusDivisions: censusDivisionsCheckboxName,
    censusSubdivisions: censusSubdivisionsCheckboxName,
    designatedPlaces: designatedPlacesCheckboxName,
    fsa: fsaCheckboxName,
  };

  /**
   * Orchestrates initialization of all map layers, UI controls, and event listeners.
   */
  function initLayers() {
    initProvincesLayer();
    initCensusDivisionsLayer();
    initCensusSubdivisionsLayer();
    initDesignatedPlacesLayer();
    initFSALayer();

    sdk.Map.setLayerOpacity({ layerName: PROVINCES_LAYER_NAME, opacity: _settings.layers.provinces.opacity });
    sdk.Map.setLayerOpacity({ layerName: CENSUS_DIVISIONS_LAYER_NAME, opacity: _settings.layers.censusDivisions.opacity });
    sdk.Map.setLayerOpacity({ layerName: CENSUS_SUBDIVISIONS_LAYER_NAME, opacity: _settings.layers.censusSubdivisions.opacity });
    sdk.Map.setLayerOpacity({ layerName: DESIGNATED_PLACES_LAYER_NAME, opacity: _settings.layers.designatedPlaces.opacity });
    sdk.Map.setLayerOpacity({ layerName: FSA_LAYER_NAME, opacity: _settings.layers.fsa.opacity });

    sdk.Map.setLayerVisibility({ layerName: PROVINCES_LAYER_NAME, visibility: _settings.layers.provinces.visible });
    sdk.Map.setLayerVisibility({ layerName: CENSUS_DIVISIONS_LAYER_NAME, visibility: _settings.layers.censusDivisions.visible });
    sdk.Map.setLayerVisibility({ layerName: CENSUS_SUBDIVISIONS_LAYER_NAME, visibility: _settings.layers.censusSubdivisions.visible });
    sdk.Map.setLayerVisibility({ layerName: DESIGNATED_PLACES_LAYER_NAME, visibility: _settings.layers.designatedPlaces.visible });
    sdk.Map.setLayerVisibility({ layerName: FSA_LAYER_NAME, visibility: _settings.layers.fsa.visible });

    sdk.LayerSwitcher.addLayerCheckbox({ name: provincesCheckboxName });
    sdk.LayerSwitcher.setLayerCheckboxChecked({ name: provincesCheckboxName, isChecked: _settings.layers.provinces.visible });
    sdk.LayerSwitcher.addLayerCheckbox({ name: censusDivisionsCheckboxName });
    sdk.LayerSwitcher.setLayerCheckboxChecked({ name: censusDivisionsCheckboxName, isChecked: _settings.layers.censusDivisions.visible });
    sdk.LayerSwitcher.addLayerCheckbox({ name: censusSubdivisionsCheckboxName });
    sdk.LayerSwitcher.setLayerCheckboxChecked({ name: censusSubdivisionsCheckboxName, isChecked: _settings.layers.censusSubdivisions.visible });
    sdk.LayerSwitcher.addLayerCheckbox({ name: designatedPlacesCheckboxName });
    sdk.LayerSwitcher.setLayerCheckboxChecked({ name: designatedPlacesCheckboxName, isChecked: _settings.layers.designatedPlaces.visible });
    sdk.LayerSwitcher.addLayerCheckbox({ name: fsaCheckboxName });
    sdk.LayerSwitcher.setLayerCheckboxChecked({ name: fsaCheckboxName, isChecked: _settings.layers.fsa.visible });

    sdk.Events.on({ eventName: 'wme-layer-checkbox-toggled', eventHandler: onLayerCheckboxToggled });
    sdk.Events.on({ eventName: 'wme-map-move-end', eventHandler: onMapMoveEnd });
  }

  // ============================================
  // SHORTCUT KEY UTILITIES
  // ============================================

  const KEYCODE_MAP = Object.fromEntries([
    ...Array.from({ length: 26 }, (_, i) => [65 + i, String.fromCharCode(65 + i)]),
    ...Array.from({ length: 10 }, (_, i) => [48 + i, String(i)]),
    [32, 'Space'], [13, 'Enter'], [9, 'Tab'], [27, 'Esc'], [8, 'Backspace'],
    [46, 'Delete'], [36, 'Home'], [35, 'End'], [33, 'PageUp'], [34, 'PageDown'],
    [45, 'Insert'], [37, '←'], [38, '↑'], [39, '→'], [40, '↓'],
    [112, 'F1'], [113, 'F2'], [114, 'F3'], [115, 'F4'], [116, 'F5'], [117, 'F6'],
    [118, 'F7'], [119, 'F8'], [120, 'F9'], [121, 'F10'], [122, 'F11'], [123, 'F12'],
    [188, ','], [190, '.'], [191, '/'], [186, ';'], [222, "'"], [219, '['],
    [221, ']'], [220, '\\'], [189, '-'], [187, '='], [192, '`'],
  ]);

  const MOD_LOOKUP = { C: 1, S: 2, A: 4 };
  const MOD_FLAGS = [
    { flag: 1, char: 'C' },
    { flag: 2, char: 'S' },
    { flag: 4, char: 'A' },
  ];

  /**
   * Converts a shortcut combo string to raw keycode string for the SDK.
   *
   * @param {string} comboStr - Shortcut string from SDK
   * @returns {string} Raw format "modifier,keycode"
   */
  function comboToRawKeycodes(comboStr) {
    if (!comboStr || typeof comboStr !== 'string') return comboStr;
    if (/^\d+,\d+$/.test(comboStr)) return comboStr;
    if (/^[A-Z0-9]$/.test(comboStr)) return `0,${comboStr.charCodeAt(0)}`;
    const match = comboStr.match(/^([ACS]+)\+([A-Z0-9])$/);
    if (!match) return comboStr;
    const [, modStr, keyStr] = match;
    const modValue = modStr.split('').reduce((acc, m) => acc | (MOD_LOOKUP[m] || 0), 0);
    return `${modValue},${keyStr.charCodeAt(0)}`;
  }

  /**
   * Converts raw keycode string to human-readable combo for SDK registration.
   *
   * @param {string} keycodeStr - Raw keycode string "modifier,keycode"
   * @returns {string|null} Human-readable combo or null if no shortcut
   */
  function shortcutKeycodesToCombo(keycodeStr) {
    if (!keycodeStr || keycodeStr === 'None') return null;
    if (/^([ACS]+\+)?[A-Z0-9]$/.test(keycodeStr)) return keycodeStr;
    const parts = keycodeStr.split(',');
    if (parts.length !== 2) return keycodeStr;
    const intMod = parseInt(parts[0], 10);
    const keyNum = parseInt(parts[1], 10);
    if (isNaN(intMod) || isNaN(keyNum)) return keycodeStr;
    const modLetters = MOD_FLAGS.filter(({ flag }) => intMod & flag)
      .map(({ char }) => char)
      .join('');
    const keyChar = KEYCODE_MAP[keyNum] || String(keyNum);
    return modLetters ? `${modLetters}+${keyChar}` : keyChar;
  }

  /**
   * Saves current shortcut assignments to settings on page unload.
   */
  function saveShortcutSettings() {
    try {
      const allShortcuts = sdk.Shortcuts.getAllShortcuts();
      allShortcuts.forEach((shortcut) => {
        if (_settings.shortcuts[shortcut.shortcutId]) {
          const sdkValue = shortcut.shortcutKeys;
          const raw = comboToRawKeycodes(sdkValue);
          const combo = shortcutKeycodesToCombo(raw);
          _settings.shortcuts[shortcut.shortcutId] = { raw, combo };
        }
      });
      saveSettings();
    } catch (e) {
      logError(`Failed to save shortcut settings: ${e.message}`);
    }
  }

  // ============================================
  // MODERN UI IMPLEMENTATION
  // ============================================

  /**
   * Updates a slider's visual fill and adjacent percentage label.
   *
   * @param {HTMLInputElement} slider - Range input element (0.0–1.0)
   */
  function updateSliderBackground(slider) {
    const value = parseFloat(slider.value);
    const percent = value * 100;
    const primaryColor = '#4a90e2';
    const separatorColor = '#e1e4e8';
    slider.style.background = `linear-gradient(to right, ${primaryColor} 0%, ${primaryColor} ${percent}%, ${separatorColor} ${percent}%, ${separatorColor} 100%)`;
    const valueDisplay = slider.closest('.cagb-slider-group')
      ? slider.closest('.cagb-slider-group').querySelector('.cagb-slider-value')
      : null;
    if (valueDisplay) {
      valueDisplay.textContent = `${Math.round(percent)}%`;
    }
  }

  /**
   * Injects Font Awesome, Google Fonts, and all CSS for the CAGB panel.
   */
  function initModernUI() {
    if (!document.querySelector('link[href*="font-awesome"]')) {
      const faLink = document.createElement('link');
      faLink.rel = 'stylesheet';
      faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
      document.head.appendChild(faLink);
    }

    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap';
    document.head.appendChild(fontLink);

    const styleEl = document.createElement('style');
    styleEl.textContent = `
      .wme-cagb-panel .cagb-container {
        font-family: 'Rubik', -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--content_default);
        line-height: 1.6;
        padding-right: 10px;
        padding-left: 3px;
        box-sizing: border-box;
      }

      .wme-cagb-panel .cagb-header {
        background: linear-gradient(135deg, #c0392b 0%, #e74c3c 50%, #e8593a 100%);
        padding: 10px;
        border-radius: 12px 12px 0 0;
        margin: -8px -8px 16px -8px;
        position: relative;
        overflow: hidden;
      }

      .wme-cagb-panel .cagb-header::before {
        content: '';
        position: absolute;
        top: -50%;
        right: -20%;
        width: 200px;
        height: 200px;
        background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%);
        pointer-events: none;
      }

      .wme-cagb-panel .cagb-header-content { position: relative; z-index: 1; }

      .wme-cagb-panel .cagb-header-title {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 4px;
      }

      .wme-cagb-panel .cagb-header-icon {
        width: 32px; height: 32px;
        background: rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(10px);
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        color: white; font-size: 16px;
      }

      .wme-cagb-panel .cagb-header h1 {
        color: white; font-size: 18px; font-weight: 600;
        letter-spacing: -0.3px; margin: 0;
      }

      .wme-cagb-panel .cagb-header-subtitle {
        color: rgba(255, 255, 255, 0.9);
        font-size: 12px; margin-left: 42px;
      }

      .wme-cagb-panel .cagb-quick-presets {
        background: var(--surface_variant);
        padding: 12px; border-radius: 8px; margin-bottom: 12px;
      }

      .wme-cagb-panel .cagb-presets-label {
        font-size: 10px; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.8px; color: var(--content_p2);
        margin-bottom: 8px; display: block;
      }

      .wme-cagb-panel .cagb-preset-chips { display: flex; gap: 6px; flex-wrap: wrap; }

      .wme-cagb-panel .cagb-preset-chip {
        padding: 6px 12px;
        background: var(--background_default);
        border: 1px solid var(--hairline);
        border-radius: 16px; font-size: 11px; font-weight: 500;
        color: var(--content_p1); cursor: pointer;
        transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
        white-space: nowrap;
      }

      .wme-cagb-panel .cagb-preset-chip:hover {
        background: #c0392b; color: white; border-color: #c0392b;
        transform: scale(1.05);
      }

      .wme-cagb-panel .cagb-layer-card {
        background: var(--surface_default);
        border-radius: 10px; margin-bottom: 10px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06); overflow: hidden;
        transition: all 250ms cubic-bezier(0.4, 0, 0.2, 1);
        border: 1px solid transparent;
      }

      .wme-cagb-panel .cagb-layer-card:hover {
        box-shadow: 0 4px 6px rgba(0,0,0,0.05);
        border-color: var(--separator);
      }

      .wme-cagb-panel .cagb-layer-card.expanded {
        box-shadow: 0 10px 15px rgba(0,0,0,0.08);
      }

      .wme-cagb-panel .cagb-layer-header {
        padding: 12px 14px; display: flex; align-items: center;
        justify-content: space-between; cursor: pointer; user-select: none;
        position: relative; transition: background 150ms;
      }

      .wme-cagb-panel .cagb-layer-header:hover { background: var(--surface_variant); }

      .wme-cagb-panel .cagb-layer-header::before {
        content: ''; position: absolute; left: 0; top: 0; bottom: 0;
        width: 4px; background: var(--accent-color); transition: width 150ms;
      }

      .wme-cagb-panel .cagb-layer-title-group {
        display: flex; align-items: center; gap: 10px; flex: 1;
      }

      .wme-cagb-panel .cagb-layer-icon {
        width: 32px; height: 32px; border-radius: 7px;
        display: flex; align-items: center; justify-content: center;
        font-size: 14px;
        background: linear-gradient(135deg, var(--accent-color) 0%, var(--accent-color-light) 100%);
        color: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }

      .wme-cagb-panel .cagb-layer-title {
        font-size: 14px; font-weight: 600; color: var(--content_default);
        letter-spacing: -0.2px; display: flex; align-items: center; gap: 8px;
      }

      .wme-cagb-panel .cagb-layer-controls-inline {
        display: flex; align-items: center; gap: 10px;
      }

      .wme-cagb-panel .cagb-visibility-toggle {
        position: relative; width: 40px; height: 22px;
        background: var(--separator); border-radius: 11px;
        cursor: pointer; transition: background 250ms;
      }

      .wme-cagb-panel .cagb-visibility-toggle.active { background: #c0392b; }

      .wme-cagb-panel .cagb-visibility-toggle::after {
        content: ''; position: absolute; top: 2px; left: 2px;
        width: 18px; height: 18px; background: white; border-radius: 9px;
        transition: transform 250ms; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      }

      .wme-cagb-panel .cagb-visibility-toggle.active::after { transform: translateX(18px); }

      .wme-cagb-panel .cagb-expand-icon {
        color: var(--content_p2); font-size: 16px; transition: transform 250ms;
      }

      .wme-cagb-panel .cagb-layer-card.expanded .cagb-expand-icon { transform: rotate(180deg); }

      .wme-cagb-panel .cagb-layer-content {
        max-height: 0; overflow: hidden;
        transition: max-height 350ms cubic-bezier(0.4, 0, 0.2, 1);
      }

      .wme-cagb-panel .cagb-layer-card.expanded .cagb-layer-content { max-height: 600px; }

      .wme-cagb-panel .cagb-layer-content-inner { padding: 0 14px 14px 14px; }

      .wme-cagb-panel .cagb-settings-grid { display: grid; gap: 12px; }

      .wme-cagb-panel .cagb-form-group { display: flex; flex-direction: column; gap: 6px; }

      .wme-cagb-panel .cagb-form-label {
        font-size: 11px; font-weight: 600; color: var(--content_p1);
        text-transform: uppercase; letter-spacing: 0.4px;
        display: flex; align-items: center; gap: 5px;
      }

      .wme-cagb-panel .cagb-color-group {
        display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
      }

      .wme-cagb-panel .cagb-color-picker-display {
        height: 36px; border-radius: 7px; cursor: pointer;
        border: 2px solid var(--hairline); position: relative;
        transition: all 150ms; overflow: hidden;
      }

      .wme-cagb-panel .cagb-color-picker-display:hover {
        transform: scale(1.03);
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      }

      .wme-cagb-panel .cagb-slider-group {
        display: flex; align-items: center; gap: 10px;
      }

      .wme-cagb-panel .cagb-slider-wrapper { flex: 1; }

      .wme-cagb-panel .cagb-slider {
        width: 100%; height: 6px; border-radius: 3px;
        -webkit-appearance: none; appearance: none; outline: none; cursor: pointer;
      }

      .wme-cagb-panel .cagb-slider::-webkit-slider-thumb {
        -webkit-appearance: none; width: 16px; height: 16px;
        border-radius: 50%; background: #c0392b;
        box-shadow: 0 1px 3px rgba(0,0,0,0.2); cursor: pointer;
        transition: transform 150ms;
      }

      .wme-cagb-panel .cagb-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }

      .wme-cagb-panel .cagb-slider-value {
        font-size: 12px; font-weight: 600; color: var(--content_p1);
        min-width: 36px; text-align: right;
      }

      .wme-cagb-panel .cagb-slider-presets { display: flex; gap: 4px; flex-wrap: wrap; }

      .wme-cagb-panel .cagb-slider-preset {
        padding: 3px 8px; background: var(--surface_variant);
        border: 1px solid var(--hairline); border-radius: 4px;
        font-size: 10px; font-weight: 600; color: var(--content_p2);
        cursor: pointer; transition: all 150ms;
      }

      .wme-cagb-panel .cagb-slider-preset:hover {
        background: #c0392b; color: white; border-color: #c0392b;
      }

      .wme-cagb-panel .cagb-input-number {
        width: 100%; padding: 8px 12px; border-radius: 7px;
        border: 1.5px solid var(--hairline); background: var(--background_default);
        color: var(--content_default); font-size: 13px;
        transition: border-color 150ms; box-sizing: border-box;
      }

      .wme-cagb-panel .cagb-input-number:focus {
        outline: none; border-color: #c0392b;
        box-shadow: 0 0 0 3px rgba(192,57,43,0.1);
      }

      .wme-cagb-panel .cagb-checkbox-wrapper {
        display: flex; align-items: center; gap: 10px; cursor: pointer;
      }

      .wme-cagb-panel .cagb-checkbox-input { display: none; }

      .wme-cagb-panel .cagb-checkbox-custom {
        width: 18px; height: 18px; border-radius: 4px;
        border: 2px solid var(--hairline); background: var(--background_default);
        display: flex; align-items: center; justify-content: center;
        transition: all 150ms; flex-shrink: 0;
      }

      .wme-cagb-panel .cagb-checkbox-input:checked + .cagb-checkbox-custom {
        background: #c0392b; border-color: #c0392b; color: white; font-size: 11px;
      }

      .wme-cagb-panel .cagb-checkbox-label { font-size: 13px; color: var(--content_default); flex: 1; }

      .wme-cagb-panel .cagb-btn {
        height: 36px; padding: 0 16px; border: none; border-radius: 7px;
        font-family: 'Rubik', sans-serif; font-size: 13px; font-weight: 600;
        cursor: pointer; transition: all 150ms;
        display: inline-flex; align-items: center; justify-content: center;
        gap: 6px; letter-spacing: 0.2px;
      }

      .wme-cagb-panel .cagb-btn-secondary {
        background: var(--surface_default); color: var(--content_default);
        border: 2px solid var(--hairline);
      }

      .wme-cagb-panel .cagb-btn-secondary:hover {
        border-color: #c0392b; color: #c0392b; transform: translateY(-1px);
      }

      .wme-cagb-panel .cagb-footer-actions {
        margin-top: 12px; display: flex; justify-content: center;
      }

      .wme-cagb-panel .cagb-tooltip-icon {
        display: inline-flex; align-items: center; justify-content: center;
        width: 14px; height: 14px; border-radius: 50%;
        background: var(--separator); color: var(--content_p2); font-size: 9px;
        cursor: help;
      }

      /* Layer accent colours */
      .wme-cagb-panel .cagb-layer-card[data-layer="provinces"] {
        --accent-color: #536dfe; --accent-color-light: #7c8ff9;
      }
      .wme-cagb-panel .cagb-layer-card[data-layer="censusDivisions"] {
        --accent-color: #ff7043; --accent-color-light: #ff8a65;
      }
      .wme-cagb-panel .cagb-layer-card[data-layer="censusSubdivisions"] {
        --accent-color: #00c853; --accent-color-light: #69f0ae;
      }
      .wme-cagb-panel .cagb-layer-card[data-layer="designatedPlaces"] {
        --accent-color: #aa00ff; --accent-color-light: #ea80fc;
      }
      .wme-cagb-panel .cagb-layer-card[data-layer="fsa"] {
        --accent-color: #ff5252; --accent-color-light: #ff6e76;
      }
    `;
    document.head.appendChild(styleEl);
  }

  /**
   * Builds a layer configuration card for the modern UI.
   *
   * @param {string} layerKey - Layer identifier
   * @param {string} displayName - Display name for the card header
   * @param {string} icon - Font Awesome icon class
   * @param {Object} [opts={}] - Options: showMinZoom, showDynamicLabels
   * @returns {HTMLElement} Card DOM element
   */
  function buildLayerCard(layerKey, displayName, icon, opts = {}) {
    const s = _settings.layers[layerKey];
    const { showMinZoom = false, showDynamicLabels = true } = opts;

    const card = document.createElement('div');
    card.className = 'cagb-layer-card';
    card.setAttribute('data-layer', layerKey);

    card.innerHTML = `
      <div class="cagb-layer-header">
        <div class="cagb-layer-title-group">
          <div class="cagb-layer-icon"><i class="${icon}"></i></div>
          <div class="cagb-layer-title">${displayName}</div>
        </div>
        <div class="cagb-layer-controls-inline">
          <div class="cagb-visibility-toggle ${s.visible ? 'active' : ''}"></div>
          <i class="fas fa-chevron-down cagb-expand-icon"></i>
        </div>
      </div>
      <div class="cagb-layer-content">
        <div class="cagb-layer-content-inner">
          <div class="cagb-settings-grid">
            ${showDynamicLabels ? `
            <div class="cagb-checkbox-wrapper">
              <label class="cagb-checkbox-input">
                <input type="checkbox" ${s.dynamicLabels ? 'checked' : ''} data-setting="dynamicLabels">
                <div class="cagb-checkbox-custom"><i class="fas fa-check"></i></div>
              </label>
              <span class="cagb-checkbox-label">
                Dynamic label positions
                <span class="cagb-tooltip-icon" title="Automatically position labels at optimal locations">
                  <i class="fas fa-question"></i>
                </span>
              </span>
            </div>` : ''}
            <div class="cagb-color-group">
              <div class="cagb-form-group">
                <label class="cagb-form-label">
                  Boundary Color
                  <span class="cagb-tooltip-icon" title="Color of the boundary lines"><i class="fas fa-question"></i></span>
                </label>
                <div class="cagb-color-picker-display" style="background: ${s.color};" data-color="${s.color}">
                  <input type="color" value="${s.color}" data-setting="color"
                    style="opacity: 0; position: absolute; pointer-events: none;">
                </div>
              </div>
              <div class="cagb-form-group">
                <label class="cagb-form-label">Label Outline</label>
                <div class="cagb-color-picker-display" style="background: ${s.labelOutlineColor};" data-color="${s.labelOutlineColor}">
                  <input type="color" value="${s.labelOutlineColor}" data-setting="labelOutlineColor"
                    style="opacity: 0; position: absolute; pointer-events: none;">
                </div>
              </div>
            </div>
            <div class="cagb-form-group">
              <label class="cagb-form-label">
                Opacity
                <span class="cagb-tooltip-icon" title="Transparency level of the layer"><i class="fas fa-question"></i></span>
              </label>
              <div class="cagb-slider-group">
                <div class="cagb-slider-wrapper">
                  <input type="range" class="cagb-slider" min="0" max="1" step="0.05"
                    value="${s.opacity}" data-setting="opacity">
                </div>
                <div class="cagb-slider-value">${Math.round(s.opacity * 100)}%</div>
              </div>
              <div class="cagb-slider-presets">
                <button class="cagb-slider-preset" data-value="0.25">25%</button>
                <button class="cagb-slider-preset" data-value="0.5">50%</button>
                <button class="cagb-slider-preset" data-value="0.75">75%</button>
                <button class="cagb-slider-preset" data-value="1">100%</button>
              </div>
            </div>
            ${showMinZoom ? `
            <div class="cagb-form-group">
              <label class="cagb-form-label">
                Minimum Zoom Level
                <span class="cagb-tooltip-icon" title="Layer will only display at or above this zoom level">
                  <i class="fas fa-question"></i>
                </span>
              </label>
              <input type="number" class="cagb-input-number" min="1" max="22"
                value="${s.minZoom}" data-setting="minZoom">
            </div>` : ''}
          </div>
        </div>
      </div>
    `;

    // Toggle expand/collapse on header click
    const header = card.querySelector('.cagb-layer-header');
    header.addEventListener('click', (e) => {
      if (e.target.closest('.cagb-visibility-toggle')) return;
      card.classList.toggle('expanded');
    });

    // Visibility toggle
    const toggle = card.querySelector('.cagb-visibility-toggle');
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLayerVisibility(layerKey);
    });

    // Color pickers
    card.querySelectorAll('.cagb-color-picker-display').forEach((display) => {
      const input = display.querySelector('input[type="color"]');
      input.style.pointerEvents = 'auto';

      display.addEventListener('click', () => input.click());
      input.addEventListener('input', (e) => {
        const color = e.target.value;
        display.style.background = color;
        const setting = input.getAttribute('data-setting');
        _settings.layers[layerKey][setting] = color;
        sdk.Map.redrawLayer({ layerName: LAYER_NAME_MAP[layerKey] });
        saveSettings();
      });
    });

    // Opacity slider
    const slider = card.querySelector('input[data-setting="opacity"]');
    if (slider) {
      updateSliderBackground(slider);
      slider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        updateSliderBackground(e.target);
        _settings.layers[layerKey].opacity = value;
        sdk.Map.setLayerOpacity({ layerName: LAYER_NAME_MAP[layerKey], opacity: value });
        saveSettings();
      });

      card.querySelectorAll('.cagb-slider-preset').forEach((btn) => {
        btn.addEventListener('click', () => {
          const value = parseFloat(btn.getAttribute('data-value'));
          slider.value = value;
          updateSliderBackground(slider);
          _settings.layers[layerKey].opacity = value;
          sdk.Map.setLayerOpacity({ layerName: LAYER_NAME_MAP[layerKey], opacity: value });
          saveSettings();
        });
      });
    }

    // Dynamic labels checkbox
    const dynamicLabelsCheckbox = card.querySelector('input[data-setting="dynamicLabels"]');
    if (dynamicLabelsCheckbox) {
      dynamicLabelsCheckbox.addEventListener('change', (e) => {
        _settings.layers[layerKey].dynamicLabels = e.target.checked;
        saveSettings();
        fetchBoundaries();
      });
    }

    // Min zoom input
    const minZoomInput = card.querySelector('input[data-setting="minZoom"]');
    if (minZoomInput) {
      minZoomInput.addEventListener('change', (e) => {
        _settings.layers[layerKey].minZoom = parseInt(e.target.value, 10);
        saveSettings();
        fetchBoundaries();
      });
    }

    return card;
  }

  /**
   * Applies a predefined style preset to all boundary layers.
   *
   * Available presets:
   * - 'high-contrast': Bright colors at 90% opacity
   * - 'minimal': Current colors at 30% opacity
   * - 'colorblind': IBM Design colorblind-friendly palette
   * - 'night': Dark jewel tones at 70% opacity
   *
   * @param {string} presetName - Name of preset to apply
   */
  function applyPreset(presetName) {
    const presets = {
      'high-contrast': {
        settings: {
          provinces: { color: '#0000ff', opacity: 0.9 },
          censusDivisions: { color: '#ffcc00', opacity: 0.9 },
          censusSubdivisions: { color: '#00cc00', opacity: 0.9 },
          designatedPlaces: { color: '#ff00ff', opacity: 0.9 },
          fsa: { color: '#ff0000', opacity: 0.9 },
        },
      },
      minimal: {
        settings: {
          provinces: { opacity: 0.3 },
          censusDivisions: { opacity: 0.3 },
          censusSubdivisions: { opacity: 0.3 },
          designatedPlaces: { opacity: 0.3 },
          fsa: { opacity: 0.3 },
        },
      },
      colorblind: {
        settings: {
          provinces: { color: '#0173B2' },
          censusDivisions: { color: '#DE8F05' },
          censusSubdivisions: { color: '#029E73' },
          designatedPlaces: { color: '#CC78BC' },
          fsa: { color: '#ECE133' },
        },
      },
      night: {
        settings: {
          provinces: { color: '#00008B', opacity: 0.7 },
          censusDivisions: { color: '#8B4500', opacity: 0.7 },
          censusSubdivisions: { color: '#005000', opacity: 0.7 },
          designatedPlaces: { color: '#4B0082', opacity: 0.7 },
          fsa: { color: '#8B0000', opacity: 0.7 },
        },
      },
    };

    const preset = presets[presetName];
    if (preset) {
      Object.keys(preset.settings).forEach((layerKey) => {
        Object.keys(preset.settings[layerKey]).forEach((setting) => {
          _settings.layers[layerKey][setting] = preset.settings[layerKey][setting];
        });
        if (preset.settings[layerKey].opacity !== undefined) {
          sdk.Map.setLayerOpacity({
            layerName: LAYER_NAME_MAP[layerKey],
            opacity: preset.settings[layerKey].opacity,
          });
        }
        if (preset.settings[layerKey].color !== undefined) {
          sdk.Map.redrawLayer({ layerName: LAYER_NAME_MAP[layerKey] });
        }
      });
      saveSettings();

      setTimeout(() => {
        const tabPane = document.querySelector('[data-cagb-tab]');
        if (tabPane) {
          const container = tabPane.querySelector('.cagb-container');
          if (container) {
            const newContainer = buildMainUI();
            container.replaceWith(newContainer);
          }
        }
      }, 100);
    }
  }

  /**
   * Builds the complete modern UI panel with all controls and layer cards.
   *
   * @returns {HTMLElement} Complete UI container element
   */
  function buildMainUI() {
    const container = document.createElement('div');
    container.className = 'cagb-container';

    // Header
    const header = document.createElement('div');
    header.className = 'cagb-header';
    header.innerHTML = `
      <div class="cagb-header-content">
        <div class="cagb-header-title">
          <div class="cagb-header-icon"><i class="fas fa-map-marked-alt"></i></div>
          <h1>CA Government Boundaries</h1>
        </div>
        <div class="cagb-header-subtitle">Configure Canadian boundary layers</div>
      </div>
    `;
    container.appendChild(header);

    // Quick Presets
    const presetsDiv = document.createElement('div');
    presetsDiv.className = 'cagb-quick-presets';
    presetsDiv.innerHTML = `
      <span class="cagb-presets-label">Quick Presets</span>
      <div class="cagb-preset-chips">
        <div class="cagb-preset-chip" data-preset="high-contrast">
          <i class="fas fa-adjust"></i> High Contrast
        </div>
        <div class="cagb-preset-chip" data-preset="minimal">
          <i class="fas fa-minus-circle"></i> Minimal
        </div>
        <div class="cagb-preset-chip" data-preset="colorblind">
          <i class="fas fa-eye"></i> Colorblind
        </div>
        <div class="cagb-preset-chip" data-preset="night">
          <i class="fas fa-moon"></i> Night Mode
        </div>
      </div>
    `;
    presetsDiv.querySelectorAll('.cagb-preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => applyPreset(chip.getAttribute('data-preset')));
    });
    container.appendChild(presetsDiv);

    // Layer Cards
    container.appendChild(
      buildLayerCard('provinces', 'Provinces & Territories', 'fas fa-flag', {
        showDynamicLabels: false,
      })
    );
    container.appendChild(
      buildLayerCard('censusDivisions', 'Census Divisions', 'fas fa-map', { showMinZoom: true })
    );
    container.appendChild(
      buildLayerCard('censusSubdivisions', 'Census Subdivisions', 'fas fa-city', {
        showMinZoom: true,
      })
    );
    container.appendChild(
      buildLayerCard('designatedPlaces', 'Designated Places', 'fas fa-map-pin', {
        showMinZoom: true,
      })
    );
    container.appendChild(
      buildLayerCard('fsa', 'Forward Sortation Areas', 'fas fa-hashtag', { showMinZoom: true })
    );

    // Footer Actions
    const footerActions = document.createElement('div');
    footerActions.className = 'cagb-footer-actions';
    footerActions.innerHTML = `
      <button class="cagb-btn cagb-btn-secondary" id="cagb-reset-all">
        <i class="fas fa-redo"></i>
        Reset all to script defaults
      </button>
    `;

    footerActions.querySelector('#cagb-reset-all').addEventListener('click', () => {
      if (confirm('Are you sure you want to reset all settings to defaults?')) {
        _settings = getDefaultSettings();
        saveSettings();

        Object.keys(_settings.layers).forEach((layerKey) => {
          sdk.Map.setLayerOpacity({
            layerName: LAYER_NAME_MAP[layerKey],
            opacity: _settings.layers[layerKey].opacity,
          });
          sdk.Map.redrawLayer({ layerName: LAYER_NAME_MAP[layerKey] });
        });

        fetchBoundaries();

        setTimeout(() => {
          const tabPane = document.querySelector('[data-cagb-tab]');
          if (tabPane) {
            const oldContainer = tabPane.querySelector('.cagb-container');
            if (oldContainer) {
              const newContainer = buildMainUI();
              oldContainer.replaceWith(newContainer);
            }
          }
        }, 100);
      }
    });

    container.appendChild(footerActions);
    return container;
  }

  /**
   * Registers the CAGB sidebar tab and builds the modern UI inside it.
   */
  function initTab() {
    initModernUI();

    sdk.Sidebar.registerScriptTab()
      .then(({ tabLabel, tabPane }) => {
        tabLabel.textContent = 'CAGB';
        tabLabel.title = 'CA Government Boundaries';
        tabPane.setAttribute('data-cagb-tab', 'true');
        tabPane.classList.add('wme-cagb-panel');
        tabPane.appendChild(buildMainUI());
      })
      .catch((error) => {
        logError(`Error creating script tab: ${error}`);
      });
  }

  /**
   * Toggles a layer's visibility and synchronizes all UI elements.
   *
   * @param {string} layerKey - Layer identifier
   */
  function toggleLayerVisibility(layerKey) {
    const newVisibility = !_settings.layers[layerKey].visible;
    _settings.layers[layerKey].visible = newVisibility;
    saveSettings();
    sdk.Map.setLayerVisibility({ layerName: LAYER_NAME_MAP[layerKey], visibility: newVisibility });

    sdk.LayerSwitcher.setLayerCheckboxChecked({
      name: LAYER_CHECKBOX_NAME_MAP[layerKey],
      isChecked: newVisibility,
    });

    const layerCard = document.querySelector(`.cagb-layer-card[data-layer="${layerKey}"]`);
    if (layerCard) {
      const toggle = layerCard.querySelector('.cagb-visibility-toggle');
      if (toggle) {
        if (newVisibility) {
          toggle.classList.add('active');
        } else {
          toggle.classList.remove('active');
        }
      }
    }

    fetchBoundaries();
  }

  /**
   * Registers keyboard shortcuts with the WME SDK.
   * All shortcuts default to unassigned — users assign keys via WME Settings.
   */
  function registerShortcuts() {
    const shortcuts = [
      {
        id: 'cagb-toggle-provinces',
        description: 'Toggle Provinces & Territories layer',
        handler: () => toggleLayerVisibility('provinces'),
      },
      {
        id: 'cagb-toggle-census-divisions',
        description: 'Toggle Census Divisions layer',
        handler: () => toggleLayerVisibility('censusDivisions'),
      },
      {
        id: 'cagb-toggle-census-subdivisions',
        description: 'Toggle Census Subdivisions layer',
        handler: () => toggleLayerVisibility('censusSubdivisions'),
      },
      {
        id: 'cagb-toggle-designated-places',
        description: 'Toggle Designated Places layer',
        handler: () => toggleLayerVisibility('designatedPlaces'),
      },
      {
        id: 'cagb-toggle-fsa',
        description: 'Toggle Forward Sortation Areas layer',
        handler: () => toggleLayerVisibility('fsa'),
      },
    ];

    let needsSave = false;

    shortcuts.forEach(({ id, description, handler }) => {
      try {
        const comboKeys = _settings.shortcuts[id]?.combo || null;
        sdk.Shortcuts.createShortcut({ shortcutId: id, shortcutKeys: comboKeys, description, callback: handler });
      } catch (e) {
        if (e.message && e.message.includes('already in use')) {
          _settings.shortcuts[id] = { raw: null, combo: null };
          needsSave = true;
          try {
            sdk.Shortcuts.createShortcut({ shortcutId: id, shortcutKeys: null, description, callback: handler });
          } catch (retryError) {
            logError(`Failed to register ${id} even with null keys: ${retryError.message}`);
          }
        } else {
          logError(`Failed to register ${id}: ${e.message}`);
        }
      }
    });

    if (needsSave) saveSettings();
  }

  // Save shortcut settings on page unload
  window.addEventListener('beforeunload', saveShortcutSettings);

  /**
   * Main initialization function.
   */
  function init() {
    loadSettings();
    registerShortcuts();
    initLayers();
    initTab();
    showScriptInfoAlert();
    fetchBoundaries();
    log('CA Government Boundaries initialized.');
  }

  window.CAGB_Debug = {
    settings: () => _settings,
    shortcuts: () => _settings.shortcuts,
  };

  init();
})();
