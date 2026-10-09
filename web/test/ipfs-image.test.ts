import { describe, expect, it } from "vitest";
import { cidOf, tokenImage } from "../lib/ipfs-image";

const CID = "QmZtYKqT3GYqLYLhDjqortJZpMHLMhAQYec5DXnkk5pi2z";

describe("token images", () => {
  it("serve a pinned image through the site's own route", () => {
    expect(cidOf(`https://ipfs.io/ipfs/${CID}`)).toBe(CID);
    expect(tokenImage(`https://ipfs.io/ipfs/${CID}`)).toBe(`/api/ipfs/${CID}`);
  });
  it("leave anything that is not a content id alone", () => {
    expect(cidOf("https://ipfs.io/ipfs/../../etc/passwd")).toBeNull();
    expect(tokenImage("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });
});
