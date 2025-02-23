/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable array-callback-return */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/restrict-template-expressions */

import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { toast } from 'react-toastify'
import Toast from '@components/Toast'
import { ReactComponent as PlusIcon } from '@assets/plusIcon.svg'
import useInfiniteScroll from '@hooks/useInfiniteScroll'
import { isFutureRatherThanServer } from '@util/validation/bool'
import { remainDueDate } from '@util/index'
import fetcher from '@util/fetcher'
import { getFeedThumbUrl } from '@util/imageQuery'
import Loading from './Loading'
import './style.scss'

interface Iposting {
  id: string
  thumbnail: string
}
interface IProps {
  isOwner: boolean
  dueDate: string
  isGroupFeed: boolean
}
const SCROLL_SIZE = 15

const FeedPostingList = ({ isOwner, dueDate, isGroupFeed }: IProps) => {
  const navigate = useNavigate()
  const { feedId } = useParams<{ feedId: string }>()
  const [postingId, setPostingId] = useState<string | null>(null)
  const [isWritabble, setIsWritabble] = useState<boolean>(false)
  const [isClickPosting, setIsClickPosting] = useState<boolean>(false)

  const getKey = (pageIndex: number, previousPageData: Iposting[]) => {
    if (previousPageData && !previousPageData.length) return null
    if (pageIndex === 0) {
      return `/posting/scroll/${feedId}?size=${isGroupFeed ? SCROLL_SIZE - 1 : isOwner ? SCROLL_SIZE : SCROLL_SIZE - 1}`
    }
    return `/posting/scroll/${feedId}?size=${SCROLL_SIZE}&index=${previousPageData[previousPageData.length - 1].id}`
  }
  const { data: postings, error, size, setSize } = useSWRInfinite(getKey, fetcher, { initialSize: 1 })
  const { data: serverTime, mutate: mutateTime } = useSWR('/serverTime', fetcher)

  // 리스트 로딩중일 때
  const isLoading = (!postings && !error) || (size > 0 && postings && typeof postings[size - 1] === 'undefined')
  // 리스트를 정상적으로 받아왔지만 비어있을 경우 (게시글이 작성되지 않았을 경우)
  const isEmpty = postings?.[0]?.length === 0
  // 쓰기 버튼이 존재할때 리스트의 끝에 도달했는지 판단
  const isExistWriteButton =
    postings != null &&
    ((postings.length === 1 && postings[0].length < SCROLL_SIZE - 1) ||
      (postings.length > 1 && postings[postings.length - 1].length < SCROLL_SIZE))
  // 쓰기 버튼이 존재하지 않을 때 리스트의 끝에 도달했는지 판단
  const isNotExistWriteButton = postings != null && postings[postings.length - 1].length < SCROLL_SIZE
  // 그룹피드, 개인 피드의 주인, 개인 피드의 주인이 아닐 때 리스트의 끝에 도달했는지 판단
  const isReachingEnd =
    (isGroupFeed && isExistWriteButton) ||
    (!isGroupFeed && !isOwner && isExistWriteButton) ||
    (!isGroupFeed && isOwner && isNotExistWriteButton)

  const bottomElement = useInfiniteScroll(postings, () => {
    !isReachingEnd && setSize((size) => size + 1)
  })

  useEffect(() => {
    if (postingId) {
      const { result, remainTime } = checkDate()
      checkReadable(postingId, result, remainTime)
    }
  }, [isClickPosting])

  useEffect(() => {
    const { result } = checkDate()
    checkWritable(result)
  }, [serverTime])

  const checkDate = () => {
    return { result: isFutureRatherThanServer(dueDate, serverTime), remainTime: remainDueDate(dueDate, serverTime) }
  }

  const checkReadable = (id: string, result: boolean, remainTime: string) => {
    if (!isOwner) {
      toast('피드의 주인만 포스팅을 열람할 수 있습니다.')
    } else if (result) {
      toast(`게시물이 공개되기까지 ${remainTime} 남았어요`)
    } else navigate(`${id}`)
  }

  const checkWritable = (result: boolean) => {
    if (!result) return setIsWritabble(false)
    else if (isGroupFeed) return setIsWritabble(true)
    else if (!isOwner) return setIsWritabble(true)
    else return setIsWritabble(false)
  }

  const handleClickPosting = (postingId: string) => {
    mutateTime()
    console.log(postingId)
    setPostingId(postingId)
    setIsClickPosting(!isClickPosting)
  }

  const postingList = postings?.flat().map((posting: Iposting) => {
    return (
      <button key={posting.id} className="posting-container" onClick={() => handleClickPosting(posting.id)}>
        <img key={posting.id} className="posting" src={getFeedThumbUrl(posting.thumbnail)} />
      </button>
    )
  })

  const writePostingButton = (
    <Link className="write-posting-container" to={`/write/${feedId}`}>
      <div className="write-posting-button">
        <PlusIcon width={'5vw'} />
      </div>
    </Link>
  )

  return (
    <div className="posting-list-wrapper">
      <div>
        <div className="posting-grid">
          {isWritabble && writePostingButton}
          {!isEmpty && postingList}
        </div>
      </div>
      {isLoading ? <Loading /> : !isReachingEnd && <div className="bottom-element" ref={bottomElement}></div>}
      <Toast />
    </div>
  )
}

export default FeedPostingList
