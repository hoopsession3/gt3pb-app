// The Academy knowledge, with each recipe as PUBLISHED (0476) — for every assistant other than Ask GT3's own route,
// so no agent answers from a recipe the recipe screen no longer shows. Server-only.
import { academyKnowledge } from "./operatorKb";
import { publishedBook, DEFAULT_TENANT } from "./recipeBook";

export async function publishedKnowledge(tenant: string = DEFAULT_TENANT): Promise<string> {
  const book = await publishedBook(tenant);
  return academyKnowledge(book.cookbook, book.sources);
}
