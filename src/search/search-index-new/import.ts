import { addPage, addTag, updateTimestampMeta } from './index'
import { ExportedPage } from '../migration'

async function importPage(page: Partial<ExportedPage>) {
    await addPage({
        pageDoc: {
            content: {
                fullText: page.text,
                title: page.fullTitle,
            },
            url: page.fullUrl,
            screenshotURI: page.screenshotURI,
            favIconURI: page.favIconURI,
        },
        bookmark: page.bookmark,
        visits: page.visits.map(visit => visit.timestamp),
    })

    // Add in all tags
    await Promise.all(page.tags.map(tag => addTag(page.url, tag)))

    // Update all the visits with metadata
    await Promise.all(
        page.visits.map(
            ({ timestamp, ...visit }) =>
                Object.keys(visit).length > 0
                    ? updateTimestampMeta(page.url, timestamp, { ...visit })
                    : Promise.resolve(),
        ),
    )
}

export default importPage