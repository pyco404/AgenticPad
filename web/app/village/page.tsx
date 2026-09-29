import { redirect } from "next/navigation";

/** The village became part of the field: one page, /field, for both. */
export default function VillagePage() {
  redirect("/field");
}
