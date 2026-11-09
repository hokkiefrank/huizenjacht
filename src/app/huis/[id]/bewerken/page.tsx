import Link from "next/link";
import { notFound } from "next/navigation";
import { updateHouse } from "@/app/actions";
import { HouseForm } from "@/components/house-form";
import { requireUser } from "@/lib/auth";
import { getHouse } from "@/lib/queries";

export default async function EditHousePage({ params }: PageProps<"/huis/[id]/bewerken">) {
  await requireUser();
  const id = Number((await params).id);
  const house = Number.isInteger(id) ? await getHouse(id) : null;
  if (!house) notFound();

  return (
    <div className="card mx-auto max-w-2xl p-6">
      <Link href={`/huis/${house.id}`} className="text-sm text-stone-500">
        ← Terug
      </Link>
      <h1 className="mb-5 mt-2 text-xl font-semibold">{house.address} bewerken</h1>
      <HouseForm action={updateHouse.bind(null, house.id)} defaults={house} submitLabel="Opslaan" />
    </div>
  );
}
