// 광고·구독 없는 비상업 공개판이 승인된 Open-Meteo 주소와 필수 응답 계약만 사용하도록 검증한다.
const APPROVED_ENDPOINTS = {
  EXPO_PUBLIC_FORECAST_API_URL: "https://api.open-meteo.com/v1/forecast",
  EXPO_PUBLIC_AIR_QUALITY_API_URL: "https://air-quality-api.open-meteo.com/v1/air-quality"
};
const REQUIRED_ENDPOINTS = Object.keys(APPROVED_ENDPOINTS);
const FORECAST_ARRAYS = [
  "time",
  "temperature_2m",
  "apparent_temperature",
  "precipitation",
  "precipitation_probability",
  "wind_speed_10m",
  "wind_gusts_10m",
  "visibility",
  "uv_index",
  "relative_humidity_2m",
  "weather_code",
  "snowfall",
  "is_day"
];
const AIR_QUALITY_ARRAYS = ["time", "pm2_5", "pm10"];

function validateEndpoint(name, rawValue) {
  const value = rawValue?.trim();
  if (!value) return `${name}이(가) 설정되지 않았습니다.`;

  let url;
  try {
    url = new URL(value);
  } catch {
    return `${name}이(가) 올바른 URL이 아닙니다.`;
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (url.protocol !== "https:") return `${name}은(는) HTTPS 주소여야 합니다.`;
  if (url.port && url.port !== "443") return `${name}은(는) 표준 HTTPS 포트를 사용해야 합니다.`;
  if (url.username || url.password) return `${name}에 인증정보를 직접 넣을 수 없습니다.`;
  if (url.search || url.hash) return `${name}에 쿼리나 프래그먼트를 넣을 수 없습니다.`;
  const privateIpv4 = /^(?:0|10|127)\.|^169\.254\.|^172\.(?:1[6-9]|2\d|3[01])\.|^192\.168\.|^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname);
  const privateIpv6 = hostname === "::1" || /^(?:fc|fd)/.test(hostname) || /^fe[89ab]/.test(hostname);
  if (hostname === "localhost" || privateIpv4 || privateIpv6 || hostname.endsWith(".local")) {
    return `${name}에 로컬 개발 주소를 사용할 수 없습니다.`;
  }
  if (/^(?:.+\.)?example\.(?:com|org|net)$/.test(hostname) || hostname.endsWith(".example")) {
    return `${name}에 예시 주소를 사용할 수 없습니다.`;
  }
  if (url.toString() !== APPROVED_ENDPOINTS[name]) {
    return `${name}은(는) 승인된 Open-Meteo 공개 API 주소와 정확히 일치해야 합니다.`;
  }
  return null;
}

export function validateProductionApiConfiguration(environment = process.env) {
  const errors = REQUIRED_ENDPOINTS
    .map((name) => validateEndpoint(name, environment[name]))
    .filter(Boolean);
  const values = REQUIRED_ENDPOINTS.map((name) => environment[name]?.trim()).filter(Boolean);
  if (values.length === REQUIRED_ENDPOINTS.length && values[0] === values[1]) {
    errors.push("예보와 대기질 프록시는 서로 구분되는 API 주소여야 합니다.");
  }
  return errors;
}

function hasNonEmptyArrays(value, names) {
  return value && names.every((name) => Array.isArray(value[name]) && value[name].length > 0);
}

export function validatePreflightPayload(name, payload) {
  if (!payload || typeof payload !== "object") return `${name}이(가) JSON 객체를 반환하지 않았습니다.`;
  if (name === "EXPO_PUBLIC_FORECAST_API_URL") {
    if (!hasNonEmptyArrays(payload.hourly, FORECAST_ARRAYS)) {
      return `${name}의 시간별 예보 필수 배열이 누락됐습니다.`;
    }
    if (!hasNonEmptyArrays(payload.daily, ["time", "sunrise", "sunset"])) {
      return `${name}의 일출·일몰 필수 배열이 누락됐습니다.`;
    }
    return null;
  }
  if (!hasNonEmptyArrays(payload.hourly, AIR_QUALITY_ARRAYS)) {
    return `${name}의 시간별 대기질 필수 배열이 누락됐습니다.`;
  }
  return null;
}

function buildPreflightUrl(name, endpoint) {
  const url = new URL(endpoint);
  url.searchParams.set("latitude", "37.5665");
  url.searchParams.set("longitude", "126.978");
  url.searchParams.set("forecast_hours", "2");
  url.searchParams.set("timezone", "Asia/Seoul");
  if (name === "EXPO_PUBLIC_FORECAST_API_URL") {
    url.searchParams.set("hourly", FORECAST_ARRAYS.slice(1).join(","));
    url.searchParams.set("daily", "sunrise,sunset");
    url.searchParams.set("wind_speed_unit", "ms");
  } else {
    url.searchParams.set("hourly", AIR_QUALITY_ARRAYS.slice(1).join(","));
  }
  return url;
}

async function preflightEndpoint(name, endpoint) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(buildPreflightUrl(name, endpoint), {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return `${name} 운영 확인이 HTTP ${response.status}로 실패했습니다.`;
    let payload;
    try {
      payload = await response.json();
    } catch {
      return `${name} 운영 확인 응답이 올바른 JSON이 아닙니다.`;
    }
    return validatePreflightPayload(name, payload);
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "10초 시간 초과" : "DNS·TLS·네트워크 연결 실패";
    return `${name} 운영 확인이 실패했습니다. ${reason}.`;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function preflightProductionApiConfiguration(environment = process.env) {
  return (await Promise.all(REQUIRED_ENDPOINTS.map((name) => preflightEndpoint(name, environment[name].trim())))).filter(Boolean);
}

const shouldValidate = process.argv.includes("--strict") || process.env.EAS_BUILD_PROFILE === "production";
const configurationOnlyForTests = process.env.NODE_ENV === "test" && process.argv.includes("--configuration-only");

if (!shouldValidate) {
  console.log("production API gate: non-production build, skipped");
} else {
  const errors = validateProductionApiConfiguration();
  if (errors.length === 0 && !configurationOnlyForTests) {
    errors.push(...await preflightProductionApiConfiguration());
  }
  if (errors.length > 0) {
    console.error("production API gate: BLOCKED");
    for (const error of errors) console.error(`- ${error}`);
    console.error("EAS production 환경의 승인 URL과 DNS·TLS·필수 JSON 응답을 확인한 뒤 다시 빌드하세요.");
    process.exitCode = 1;
  } else {
    console.log("production API gate: PASS");
  }
}
