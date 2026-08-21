/**
 * Public API of the dispatch core.
 *
 * In a Foundry Functions repository, thin @Function-decorated adapters call
 * these after converting Ontology objects to the plain interfaces in types.ts.
 */
export * from "./dispatch/types";
export * from "./dispatch/geo";
export * from "./dispatch/priority";
export * from "./dispatch/eligibility";
export * from "./dispatch/scoring";
export * from "./dispatch/duplicates";
export * from "./dispatch/classifier";
