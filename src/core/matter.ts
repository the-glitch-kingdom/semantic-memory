import grayMatter from "gray-matter";

// Called without options, gray-matter caches every parse by file content: a parse that threw comes back
// unparsed (and without throwing) on the next call, and every caller shares one mutable `data` object.
// Passing options skips the cache. Import this instead of gray-matter.
const matter = Object.assign((raw: string) => grayMatter(raw, {}), { stringify: grayMatter.stringify });

export default matter;
