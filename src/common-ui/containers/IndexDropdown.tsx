import React, { Component } from 'react'
import debounce from 'lodash/fp/debounce'
import noop from 'lodash/fp/noop'

import { updateLastActive } from '../../analytics'
import { remoteFunction } from '../../util/webextensionRPC'
import {
    IndexDropdown,
    IndexDropdownNewRow,
    IndexDropdownRow,
} from '../components'

export interface Props {
    source: 'tag' | 'domain'
    /** The URL to use for dis/associating new tags with; set this to keep in sync with index. */
    url?: string
    tabId?: number
    /** Tag Filters that are previously present in the location. */
    initFilters?: string[]
    /** Opt. cb to run when new tag added to state. */
    onFilterAdd?: (filter: string) => void
    /** Opt. cb to run when tag deleted from state. */
    onFilterDel?: (filter: string) => void
}

export interface State {
    searchVal: string
    isLoading: boolean
    displayFilters: string[]
    filters: string[]
    focused: number
}

class IndexDropdownContainer extends Component<Props, State> {
    static defaultProps: Partial<Props> = {
        onFilterAdd: noop,
        onFilterDel: noop,
        initFilters: [],
    }

    private suggestRPC
    private addTagRPC
    private delTagRPC
    private inputEl: HTMLInputElement

    constructor(props: Props) {
        super(props)

        this.suggestRPC = remoteFunction('suggest')
        this.addTagRPC = remoteFunction('addTag')
        this.delTagRPC = remoteFunction('delTag')

        this.fetchTagSuggestions = debounce(300)(this.fetchTagSuggestions)

        this.state = {
            searchVal: '',
            isLoading: false,
            displayFilters: props.initFilters, // Display state objects; will change all the time
            filters: props.initFilters, // Actual tags associated with the page; will only change when DB updates
            focused: props.initFilters.length ? 0 : -1,
        }
    }

    /**
     * Domain inputs need to allow '.' while tags shouldn't.
     */
    private get inputBlockPattern() {
        return this.props.source === 'domain' ? /[^\w\s-.]/gi : /[^\w\s-]/gi
    }

    /**
     * Decides whether or not to allow index update. Currently determined by `props.url` setting.
     */
    private get allowIndexUpdate() {
        return this.props.url != null
    }

    /**
     * Selector for derived display tags state
     */
    private getDisplayTags() {
        return this.state.displayFilters.map((value, i) => ({
            value,
            active: this.pageHasTag(value),
            focused: this.state.focused === i,
        }))
    }

    private pageHasTag = (value: string) => this.state.filters.includes(value)
    private setInputRef = (el: HTMLInputElement) => (this.inputEl = el)

    /**
     * Selector for derived search value/new tag input state
     */
    private getSearchVal() {
        return this.state.searchVal
            .trim()
            .replace(/\s\s+/g, ' ')
            .toLowerCase()
    }

    private canCreateTag() {
        if (!this.allowIndexUpdate) {
            return false
        }

        const searchVal = this.getSearchVal()

        return (
            !!searchVal.length &&
            !this.state.displayFilters.reduce(
                (acc, tag) => acc || tag === searchVal,
                false,
            )
        )
    }

    /**
     * Used for 'Enter' presses or 'Add new tag' clicks.
     */
    private addTag = async () => {
        const newTag = this.getSearchVal()
        const newTags = [newTag, ...this.state.filters]

        if (this.allowIndexUpdate) {
            this.addTagRPC({
                url: this.props.url,
                tag: newTag,
                tabId: this.props.tabId,
            }).catch(console.error)
        }

        this.inputEl.focus()
        this.setState(state => ({
            ...state,
            searchVal: '',
            filters: newTags,
            displayFilters: newTags,
            focused: 0,
        }))

        this.props.onFilterAdd(newTag)
        updateLastActive() // Consider user active (analytics)
    }

    /**
     * Used for clicks on displayed tags. Will either add or remove tags to the page
     * depending on their current status as assoc. tags or not.
     */
    private handleTagSelection = (index: number) => async event => {
        const tag = this.getDisplayTags()[index].value
        const tagIndex = this.state.filters.findIndex(val => val === tag)

        let tagsReducer: (filters: string[]) => string[] = t => t

        // Either add or remove it to the main `state.tags` array
        if (tagIndex === -1) {
            if (this.allowIndexUpdate) {
                this.addTagRPC({
                    url: this.props.url,
                    tag,
                    tabId: this.props.tabId,
                }).catch(console.error)
            }

            this.props.onFilterAdd(tag)
            tagsReducer = tags => [tag, ...tags]
        } else {
            if (this.allowIndexUpdate) {
                this.delTagRPC({
                    url: this.props.url,
                    tag,
                    tabId: this.props.tabId,
                }).catch(console.error)
            }

            this.props.onFilterDel(tag)
            tagsReducer = tags => [
                ...tags.slice(0, tagIndex),
                ...tags.slice(tagIndex + 1),
            ]
        }

        this.setState(state => ({
            ...state,
            filters: tagsReducer(state.filters),
            focused: index,
        }))

        updateLastActive() // Consider user active (analytics)
    }

    private handleSearchEnterPress(
        event: React.KeyboardEvent<HTMLInputElement>,
    ) {
        event.preventDefault()

        if (
            this.canCreateTag() &&
            this.state.focused === this.state.displayFilters.length
        ) {
            return this.addTag()
        }

        if (this.state.displayFilters.length) {
            return this.handleTagSelection(this.state.focused)(event)
        }

        return null
    }

    private handleSearchArrowPress(
        event: React.KeyboardEvent<HTMLInputElement>,
    ) {
        event.preventDefault()

        // One extra index if the "add new tag" thing is showing
        let offset = this.canCreateTag() ? 0 : 1

        if (!this.allowIndexUpdate) offset = 1

        // Calculate the next focused index depending on current focus and direction
        let focusedReducer
        if (event.key === 'ArrowUp') {
            focusedReducer = focused =>
                focused < 1
                    ? this.state.displayFilters.length - offset
                    : focused - 1
        } else {
            focusedReducer = focused =>
                focused === this.state.displayFilters.length - offset
                    ? 0
                    : focused + 1
        }

        this.setState(state => ({
            ...state,
            focused: focusedReducer(state.focused),
        }))
    }

    handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        switch (event.key) {
            case 'Enter':
                return this.handleSearchEnterPress(event)
            case 'ArrowUp':
            case 'ArrowDown':
                return this.handleSearchArrowPress(event)
            default:
        }
    }

    private handleSearchChange = (
        event: React.SyntheticEvent<HTMLInputElement>,
    ) => {
        const searchVal = event.currentTarget.value

        // Block input of non-words, spaces and hypens for tags
        if (this.inputBlockPattern.test(searchVal)) {
            return
        }

        // If user backspaces to clear input, show the current assoc tags again
        const displayFilters = !searchVal.length
            ? this.state.filters
            : this.state.displayFilters

        this.setState(
            state => ({ ...state, searchVal, displayFilters }),
            this.fetchTagSuggestions, // Debounced suggestion fetch
        )
    }

    private fetchTagSuggestions = async () => {
        const searchVal = this.getSearchVal()
        if (!searchVal.length) {
            return
        }

        let suggestions = this.state.filters

        try {
            suggestions = await this.suggestRPC(searchVal, this.props.source)
        } catch (err) {
            console.error(err)
        } finally {
            this.setState(state => ({
                ...state,
                displayFilters: suggestions,
                focused: 0,
            }))
        }
    }

    private renderTags() {
        const tags = this.getDisplayTags()

        const tagOptions = tags.map((tag, i) => (
            <IndexDropdownRow
                {...tag}
                key={i}
                onClick={this.handleTagSelection(i)}
            />
        ))

        if (this.canCreateTag()) {
            tagOptions.push(
                <IndexDropdownNewRow
                    key="+"
                    value={this.state.searchVal}
                    onClick={this.addTag}
                    focused={
                        this.state.focused === this.state.displayFilters.length
                    }
                />,
            )
        }

        return tagOptions
    }

    render() {
        return (
            <IndexDropdown
                onTagSearchChange={this.handleSearchChange}
                onTagSearchKeyDown={this.handleSearchKeyDown}
                setInputRef={this.setInputRef}
                numberOfTags={this.state.filters.length}
                tagSearchValue={this.state.searchVal}
                {...this.props}
            >
                {this.renderTags()}
            </IndexDropdown>
        )
    }
}

export default IndexDropdownContainer
