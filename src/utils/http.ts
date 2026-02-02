/**
 * HTTP response utilities.
 */

/**
 * Create a JSON response with proper headers.
 */
export function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
