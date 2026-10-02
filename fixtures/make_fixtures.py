"""Builds real Anki packages with the official anki library for import tests."""
import os, shutil, tempfile, time, struct, zlib
from anki.collection import Collection, ExportAnkiPackageOptions, ExportLimit
from anki.decks import DeckId

out = os.path.dirname(os.path.abspath(__file__))
tmp = tempfile.mkdtemp()
col = Collection(os.path.join(tmp, "collection.anki2"))

# FSRS on, like a modern desktop profile
col.set_config("fsrs", True)

# a tiny PNG and a fake mp3 in the media folder
def png(w=4, h=4):
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
img = col.media.write_data("red square.png", png())
snd = col.media.write_data("gateau.mp3", b"ID3\x03\x00\x00\x00\x00\x00\x00fake-mp3")

lang = col.decks.id("Languages::French")
geo = col.decks.id("Geography")

basic_rev = col.models.by_name("Basic (and reversed card)")
basic = col.models.by_name("Basic")
cloze = col.models.by_name("Cloze")
typein = col.models.by_name("Basic (type in the answer)")

def add(model, deck, fields, tags=()):
    n = col.new_note(model)
    for i, f in enumerate(fields): n.fields[i] = f
    n.tags = list(tags)
    col.add_note(n, DeckId(deck))
    return n

add(basic_rev, lang, ["gâteau [sound:%s]" % snd, "cake"], ["french", "food"])
add(basic_rev, lang, ["pomme", "apple"], ["french", "food"])
add(basic_rev, lang, ["chien", "dog"], ["french"])
add(basic, geo, ["Capital of France?", "Paris <img src=\"%s\">" % img], ["geo::europe"])
add(basic, geo, ["Capital of Japan?", "Tokyo"], ["geo::asia"])
add(cloze, geo, ["The capital of {{c1::Australia}} is {{c2::Canberra::city}}.", "extra info"], ["geo::oceania"])
add(typein, geo, ["Longest river in Africa?", "Nile"], ["geo::africa"])

# review a few cards so there is scheduling + revlog + FSRS memory state
col.sched.extend_limits(0, 0)
did_all = [lang, geo]
answered = 0
for d in did_all:
    col.decks.select(DeckId(d))
    for _ in range(4):
        q = col.sched.get_queued_cards(fetch_limit=1)
        if not q.cards: break
        qc = q.cards[0]
        card = col.get_card(qc.card.id)
        card.start_timer()
        states = qc.states
        # press Easy so it graduates straight to review
        from anki.scheduler.v3 import CardAnswer
        ans = col.sched.build_answer(card=card, states=states, rating=CardAnswer.EASY)
        col.sched.answer_card(ans)
        answered += 1
# suspend one card
cids = col.find_cards("chien")
col.sched.suspend_cards(cids[:1])
print("answered", answered, "cards", col.card_count(), "notes", col.note_count())

def export(name, legacy, scheduling=True):
    path = os.path.join(out, name)
    col.export_anki_package(out_path=path, options=ExportAnkiPackageOptions(with_scheduling=scheduling, with_deck_configs=True, with_media=True, legacy=legacy), limit=ExportLimit if False else None)
    print("wrote", name, os.path.getsize(path))

export("modern.apkg", legacy=False)
export("legacy.apkg", legacy=True)
export("modern-noschedule.apkg", legacy=False, scheduling=False)
col.close()
shutil.rmtree(tmp)
